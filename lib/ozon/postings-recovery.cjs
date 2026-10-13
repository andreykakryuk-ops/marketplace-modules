'use strict';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {collectPostings}=require('./snapshot.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {lookupPosting}=require('./posting-lookup.cjs');
const nextDay=d=>new Date(Date.parse(d)+86400000).toISOString().slice(0,10);
async function recoverPostings(read,{start,end,previous=[],tracked=[],lastSuccess=null}){
 const from=lastSuccess&&Number.isFinite(Date.parse(lastSuccess))?new Date(Date.parse(lastSuccess)-86400000).toISOString().slice(0,10):start;
 start=from<start?from:start;
 if(start>end)throw Error('INVALID_PERIOD');
 const all=new Map(),ranges=[];let cursor=start;
 // Keep each API interval below one year; never publish a partially traversed interval.
 for(let count=0;cursor<=end;count++){
  if(count>=12)throw Error('POSTINGS_RECOVERY_LIMIT');
  const until=new Date(Math.min(Date.parse(end),Date.parse(cursor)+359*86400000)).toISOString().slice(0,10);
  for(const p of await collectPostings(read,cursor,until)){if(all.has(p.number))throw Error('POSTINGS_DUPLICATE');all.set(p.number,p);}
  ranges.push({start:cursor,end:until});cursor=nextDay(until);
 }
 const old=new Map(previous.map(p=>[p.number,p])),missing=[...new Set(tracked)].filter(id=>!all.has(id));
 const dates=[...new Set(missing.flatMap(id=>{
  const p=old.get(id);return p&&Number.isFinite(Date.parse(p.createdAt))?[new Date(p.createdAt).toISOString().slice(0,10)]:[];
 }))].sort();
 if(dates.length>31||missing.length>250)throw Error('POSTINGS_RECOVERY_LIMIT');
 for(const date of dates)for(const p of await collectPostings(read,date,date))if(missing.includes(p.number))all.set(p.number,p);
 let pointLookups=0;
 for(const number of missing.filter(id=>!all.has(id))){all.set(number,await lookupPosting(read,number));pointLookups++;}
 if(tracked.some(id=>!all.has(id)))throw Error('POSTINGS_TRACKED_MISSING');
 return {postings:[...all.values()].sort((a,b)=>a.number.localeCompare(b.number)),coverage:{ranges,trackedCount:new Set(tracked).size,recoveredTracked:missing.length,pointLookups,complete:true}};
}
module.exports={recoverPostings};

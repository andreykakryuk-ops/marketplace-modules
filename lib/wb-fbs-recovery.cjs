'use strict';
const MAX_RECOVERY_RESPONSE_BYTES=8*1024*1024;
const MAX_CURSOR=BigInt('9223372036854775807');
function invalid(){throw Error('INVALID_RESPONSE');}
function cursor(value){
 if(typeof value==='number'){
  if(!Number.isSafeInteger(value)||value<0)invalid();
  value=String(value);
 }
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,18})$/.test(value)||BigInt(value)>MAX_CURSOR)invalid();
 return value;
}
function stringEnd(raw,start){
 for(let i=start+1;i<raw.length;i++){
  if(raw[i]==='\\'){i++;continue;}
  if(raw[i]==='"')return i+1;
 }
 invalid();
}
function valueEnd(raw,start){
 if(raw[start]==='"')return stringEnd(raw,start);
 if(raw[start]==='{'||raw[start]==='['){
  let depth=0;
  for(let i=start;i<raw.length;i++){
   if(raw[i]==='"'){i=stringEnd(raw,i)-1;continue;}
   if(raw[i]==='{'||raw[i]==='[')depth++;
   if(raw[i]==='}'||raw[i]===']'){depth--;if(depth===0)return i+1;}
  }
  invalid();
 }
 let i=start;while(i<raw.length&&raw[i]!==','&&raw[i]!=='}')i++;
 return i;
}
function parseRecoveryResponse(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>MAX_RECOVERY_RESPONSE_BYTES)invalid();
 let payload;try{payload=JSON.parse(raw);}catch{invalid();}
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Array.isArray(payload.orders))invalid();
 // JSON.parse validates syntax. Scan root member boundaries to preserve the
 // original int64 token; nested properties and strings cannot supply a cursor.
 let i=0;const space=()=>{while(/\s/.test(raw[i]??'')&&i<raw.length)i++;};
 space();if(raw[i++]!=='{')invalid();
 const keys=new Set();let next=null;
 for(;;){
  space();if(raw[i]==='}'){i++;break;}
  if(raw[i]!=='"')invalid();
  const end=stringEnd(raw,i),key=JSON.parse(raw.slice(i,end));
  if(keys.has(key))invalid();keys.add(key);i=end;space();
  if(raw[i++]!==':')invalid();space();
  const finish=valueEnd(raw,i);
  if(key==='next')next=cursor(raw.slice(i,finish).trim());
  i=finish;space();if(raw[i]===','){i++;continue;}
  if(raw[i]==='}'){i++;break;}invalid();
 }
 if(next===null)invalid();
 return {next,orders:payload.orders};
}
async function readRecoveryResponse(response){
 const reader=response?.body?.getReader?.();if(!reader)invalid();
 const parts=[];let size=0,complete=false;
 try{
  for(;;){
   const result=await reader.read();
   if(result.done){complete=true;break;}
   size+=result.value.byteLength;
   if(size>MAX_RECOVERY_RESPONSE_BYTES)invalid();
   parts.push(Buffer.from(result.value));
  }
 }finally{
  if(!complete)await reader.cancel().catch(()=>{});
  reader.releaseLock();
 }
 return parseRecoveryResponse(Buffer.concat(parts,size).toString('utf8'));
}
async function collectRecoveryOrders(request,start,end){
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start)throw Error('INVALID_RECOVERY_RANGE');
 const found=new Map();
 for(let from=start;from<=end;){
  const to=Math.min(end,from+29*86400-1);let next='0',complete=false;
  for(let page=0;page<200;page++){
   const result=await request({dateFrom:from,dateTo:to,limit:1000,next});
   if(!Array.isArray(result?.orders))invalid();
   const following=cursor(result.next);
   for(const row of result.orders){
    if(row?.deliveryType!=null&&row.deliveryType!=='fbs')continue;
    if(!Number.isSafeInteger(row?.id)||row.id<=0||typeof row.article!=='string'||!row.article.trim())invalid();
    const article=row.article.trim(),old=found.get(row.id);if(old&&old.article!==article)invalid();
    found.set(row.id,{id:row.id,article});
   }
   if(following==='0'||result.orders.length===0){complete=true;break;}
   if(BigInt(following)<=BigInt(next))throw Error('PAGINATION');
   next=following;
  }
  if(!complete)throw Error('PAGINATION_LIMIT');
  from=to+1;
 }
 return [...found.values()];
}
module.exports={collectRecoveryOrders,parseRecoveryResponse,readRecoveryResponse,MAX_RECOVERY_RESPONSE_BYTES};

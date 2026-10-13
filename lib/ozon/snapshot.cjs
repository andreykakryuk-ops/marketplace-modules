'use strict';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const N=require('./normalize.cjs');
// Publish only after every page is validated. These methods never mutate Ozon.
async function pages(read,endpoint,body,normalize,{max=1000,cursorKey='last_id'}={}){
 const all=[],seen=new Set();let cursor='';
 for(let page=0;page<max;page++){
  const result=normalize(await read(endpoint,{...body,[cursorKey]:cursor}));
  all.push(...result.rows);
  if(result.hasNext===false||result.hasNext===undefined&&!result.cursor)return all;
  if(!result.cursor||result.cursor===cursor||seen.has(result.cursor))throw Error('PAGINATION');
  seen.add(result.cursor);cursor=result.cursor;
 }throw Error('PAGINATION_LIMIT');
}
async function collectPostings(read,start,end){
 N.day(start);N.day(end);if(start>end)throw Error('INVALID_PERIOD');
 return N.unique(await pages(read,'/v4/posting/fbs/list',{filter:{since:start+'T00:00:00Z',to:end+'T23:59:59Z'},limit:100,sort_dir:'ASC'},N.postings,{cursorKey:'cursor'}),r=>r.number);
}
module.exports={pages,collectPostings};

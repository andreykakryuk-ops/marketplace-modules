'use strict';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path=require('node:path'),crypto=require('node:crypto');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {atomic,readJson,exclusive}=require('./json-store.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {settings,date}=require('./procurement.cjs');
function createStore(directory){
 const file=path.join(directory,'procurement.json');
 const empty=()=>({revision:0,config:{},mapping:{},orders:[],audit:[]});
 async function read(){try{const s=await readJson(file,8*1024*1024);if(!Number.isSafeInteger(s.revision)||!Array.isArray(s.orders)||!s.config||!s.mapping||!Array.isArray(s.audit))throw Error('INVALID_STATE');return s;}catch(e){if(e.code==='ENOENT')return empty();throw e;}}
 async function change(actor,revision,input,items,kits){
  if(!actor?.id||!actor.allowed)throw Error('FORBIDDEN');
  return exclusive(file,async()=>{
   const s=await read();if(s.revision!==revision)throw Error('REVISION_CONFLICT');
   const now=new Date().toISOString(),id=String(input.itemId??''),item=items.find(i=>i.id===id&&i.stockKind==='main'&&!i.hidden);
   if(input.kind==='config'){if(!item)throw Error('INVALID_ITEM');s.config[id]=settings({leadDays:input.leadDays,safetyDays:input.safetyDays,reviewDays:input.reviewDays});}
   else if(input.kind==='order'){
    if(!item||!Number.isSafeInteger(input.quantity)||input.quantity<=0||input.quantity>10000000||!date(input.eta))throw Error('INVALID_ORDER');
    s.orders.push({id:crypto.randomUUID(),itemId:id,quantity:input.quantity,eta:input.eta,status:'ordered',createdAt:now,actor:actor.id});
   }else if(input.kind==='close'){
    const o=s.orders.find(o=>o.id===input.orderId);if(!o||o.status!=='ordered'||!['received','cancelled'].includes(input.status))throw Error('INVALID_ORDER');
    o.status=input.status;o.closedAt=now;o.closedBy=actor.id;
   }else if(input.kind==='mapping'){
    if(typeof input.key!=='string'||input.key.length>700||!input.key.includes(':')||!kits.some(k=>k.finishedItemId===input.finishedItemId&&k.status==='ok'))throw Error('INVALID_MAPPING');
    s.mapping[input.key]=input.finishedItemId;
   }else throw Error('INVALID_ACTION');
   s.revision++;s.audit.push({at:now,actor:actor.id,kind:input.kind,revision:s.revision,itemId:id});
   await atomic(file,s);return s;
  });
 }
 return {read,change};
}
module.exports={createStore};

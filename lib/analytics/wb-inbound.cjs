'use strict';
const ACTIVE = new Set([2,3,4,6]);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const id = v => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v) && Number.isSafeInteger(Number(v)) ? v : null;
function mergeSupplyRows(pages) {
 const rows=[], owners=new Map();
 for(const page of pages)for(const raw of page){
  if(!object(raw))throw Error('INVALID_SUPPLY_LIST');
  const sid=id(raw.supplyID),pid=id(raw.preorderID);
  if(!sid&&!pid)throw Error('INVALID_SUPPLY_ID');
  const keys=[sid&&'s:'+sid,pid&&'p:'+pid].filter(Boolean),found=[...new Set(keys.map(k=>owners.get(k)).filter(v=>v!==undefined))];
  if(found.length>1)throw Error('AMBIGUOUS_SUPPLY_ALIAS');
  const index=found[0]??rows.length,previous=rows[index];
  if(previous&&id(previous.supplyID)&&sid&&id(previous.supplyID)!==sid)throw Error('CONFLICTING_SUPPLY_ALIAS');
  rows[index]={...previous,...raw};
  for(const key of keys)owners.set(key,index);
 }
 return rows;
}
function projectInbound(snapshot,{storeId,catalog,warehouse=null,now=Date.now(),maxAgeMs=15*60*1000}){
 const unavailable=reason=>({complete:false,reason,fetchedAt:object(snapshot)&&typeof snapshot.fetchedAt==='string'?snapshot.fetchedAt:null,goodsFetchedAt:null,total:null,byNmId:{},dispatchedTotal:null,dispatchedByNmId:{}});
 if(!object(snapshot)||snapshot.schemaVersion!==1||snapshot.storeId!==storeId||!Array.isArray(snapshot.supplies))return unavailable('NO_VERIFIED_SUPPLY_SNAPSHOT');
 if(snapshot.listComplete!==true)return unavailable('SUPPLY_LIST_INCOMPLETE');
 if(warehouse==='Склад WB РФ')return unavailable('SUPPLY_REGION_UNVERIFIED');
 const poll=Date.parse(snapshot.fetchedAt);
 if(!Number.isFinite(poll)||now<poll||now-poll>maxAgeMs)return unavailable('SUPPLY_SNAPSHOT_STALE');
 const products=new Map(),vendors=new Map();
 for(const p of catalog){
  const nm=id(p.nmId);
  if(!nm||typeof p.vendorCode!=='string'||!p.vendorCode||products.has(nm))return unavailable('CATALOG_IDENTITY_UNVERIFIED');
  products.set(nm,p.vendorCode);vendors.set(p.vendorCode,(vendors.get(p.vendorCode)??0)+1);
 }
 let rows;try{rows=mergeSupplyRows([snapshot.supplies]);}catch{return unavailable('SUPPLY_IDENTITY_UNVERIFIED');}
 const quantities=new Map([...products.keys()].map(nm=>[nm,0])),dispatched=new Map([...products.keys()].map(nm=>[nm,0])),seen=new Set();let oldest=poll;
 for(const supply of rows){
  if(!ACTIVE.has(supply.statusID)&&supply.statusID!==1&&supply.statusID!==5)return unavailable('SUPPLY_STATUS_UNVERIFIED');
  if(supply.statusID===1||supply.statusID===5||supply.boxTypeID===0)continue;
  if(supply.goodsComplete!==true||!Array.isArray(supply.goods))return unavailable('SUPPLY_GOODS_INCOMPLETE');
  const at=Date.parse(supply.goodsFetchedAt);
  if(!Number.isFinite(at)||now<at||now-at>maxAgeMs)return unavailable('SUPPLY_GOODS_STALE');
  oldest=Math.min(oldest,at);
  if(warehouse!==null&&(typeof supply.warehouseName!=='string'||!supply.warehouseName))return unavailable('SUPPLY_WAREHOUSE_UNVERIFIED');
  const local=new Set();
  for(const good of supply.goods){
   if(!object(good))return unavailable('SUPPLY_GOODS_UNVERIFIED');
   const nm=id(good.nmID),vendor=typeof good.vendorCode==='string'?good.vendorCode:null;
   if(!nm||!products.has(nm)||products.get(nm)!==vendor)return unavailable('SUPPLY_PRODUCT_IDENTITY_UNVERIFIED');
   const planned=integer(good.quantity),accepted=integer(good.acceptedQuantity);
   if(planned===null||accepted===null||accepted>planned)return unavailable('SUPPLY_ACCEPTANCE_UNVERIFIED');
   const variant=typeof good.barcode==='string'&&good.barcode?good.barcode:null;
   if(!variant)return unavailable('SUPPLY_VARIANT_UNVERIFIED');
   const key=nm+':'+variant;if(local.has(key))return unavailable('DUPLICATE_SUPPLY_GOOD');local.add(key);
   if(warehouse===null||supply.warehouseName===warehouse){
    quantities.set(nm,quantities.get(nm)+planned-accepted);
    if(supply.statusID===4||supply.statusID===6)dispatched.set(nm,dispatched.get(nm)+planned-accepted);
   }
  }
  const key=id(supply.supplyID)?'s:'+id(supply.supplyID):'p:'+id(supply.preorderID);
  if(seen.has(key))return unavailable('DUPLICATE_SUPPLY');seen.add(key);
 }
 const byNmId=Object.fromEntries(quantities),total=[...quantities.values()].reduce((a,b)=>a+b,0),dispatchedByNmId=Object.fromEntries(dispatched),dispatchedTotal=[...dispatched.values()].reduce((a,b)=>a+b,0);
 if(!Number.isSafeInteger(total)||!Number.isSafeInteger(dispatchedTotal))return unavailable('SUPPLY_QUANTITY_OVERFLOW');
 return {complete:true,reason:null,fetchedAt:snapshot.fetchedAt,goodsFetchedAt:new Date(oldest).toISOString(),total,byNmId,dispatchedTotal,dispatchedByNmId};
}
function replenishment(orders,stock,inbound){return [orders,stock,inbound].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)?Math.max(orders-stock-inbound,0):null;}
module.exports={mergeSupplyRows,projectInbound,replenishment};

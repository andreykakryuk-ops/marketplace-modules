'use strict';
// CommonJS is shared by the server runtime and isolated Node tests.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {isDeepStrictEqual}=require('node:util');
const fail=()=>{throw Error('INVALID_RESPONSE');};
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:fail();
const list=v=>Array.isArray(v)&&v.length<=100000?v:fail();
const text=(v,max=500)=>typeof v==='string'&&v.length>0&&v.length<=max?v:fail();
const id=v=>((typeof v==='number'&&Number.isSafeInteger(v))||typeof v==='string')&&/^[1-9]\d{0,15}$/.test(String(v))?String(v):fail();
// Ozon analytics includes signed virtual warehouse IDs; SKU and cluster IDs remain positive.
const qty=v=>Number.isSafeInteger(v)&&v>=0?v:fail();
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:fail();
function cents(v){obj(v);if(v.currency!=='RUB'||typeof v.amount!=='string'||!(/^-?\d+(?:\.\d{1,2})?$/).test(v.amount))fail();const n=Math.round(Number(v.amount)*100);if(!Number.isSafeInteger(n))fail();return n;}
function unique(rows,key){const seen=new Map();for(const row of rows){const k=key(row);if(seen.has(k)&&!isDeepStrictEqual(seen.get(k),row))fail();seen.set(k,row);}return [...seen.values()];}
function postings(body){
 obj(body);if(typeof body.has_next!=='boolean'||typeof body.cursor!=='string')fail();
 return {hasNext:body.has_next,cursor:body.cursor,rows:unique(list(body.postings).map(p=>{
  const number=text(p.posting_number,120);if(!/^[\w-]+$/.test(number))fail();const createdAt=text(p.in_process_at,50);if(!Number.isFinite(Date.parse(createdAt)))fail();
  return {number,orderId:id(p.order_id),status:text(p.status,100),substatus:typeof p.substatus==='string'?p.substatus:'',createdAt,shipmentDate:p.shipment_date&&Number.isFinite(Date.parse(p.shipment_date))?p.shipment_date:null,
   warehouseId:id(p.delivery_method.warehouse_id),warehouseName:text(p.delivery_method.warehouse),products:list(p.products).map(item=>({sku:id(item.sku),offerId:text(item.offer_id),name:text(item.name,1000),quantity:qty(item.quantity),price:cents(item.price)}))};
 }),r=>r.number)};
}
module.exports={postings,cents,day,unique};

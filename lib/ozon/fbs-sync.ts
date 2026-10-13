import confirmedAccounted from './confirmed-accounted-postings.json';
import {assemblyFields,fbsUnitKey,rememberAssembly} from '../fbs-assembly';
import type {AppState} from '../types';
import type {OzonPosting} from './runtime.cjs';
export function applyOzonPostings(state:AppState,clientId:string,postings:OzonPosting[],mapping:Record<string,string>={}){
 const before=JSON.stringify({shipments:state.shipments,assembly:state.fbsAssembly??{},ozonFbs:state.ozonFbs}),handled=new Set(state.ozonFbs?.handled??[]),prefix=clientId+':';
 if(clientId===confirmedAccounted.clientId){
  for(const number of confirmedAccounted.postingNumbers)handled.add(prefix+number);
  state.ozonFbs={...state.ozonFbs,handled:[...handled]};
 }
 const productByPosting=new Map(postings.map(p=>[p.number,p]));
 for(const shipment of state.shipments){
  if(shipment.source!=='ozon-fbs'||shipment.ozonClientId!==clientId||shipment.status!=='draft')continue;
  for(const line of shipment.lines){
   const units=(line.ozonPostingIds??[]).flatMap(number=>{
    const p=productByPosting.get(number);if(!p)return [];
    return p.products.filter(x=>{
     const mapped=mapping['ozon:'+clientId+':'+x.sku];
     return mapped?mapped===line.finishedItemId:state.items.find(i=>i.id===line.finishedItemId)?.sku===x.offerId;
    }).map(x=>({key:fbsUnitKey('ozon',clientId,number,x.sku),qty:x.quantity}));
   });
   rememberAssembly(state,line,units);
  }
 }
 const groups=new Map<string,OzonPosting[]>(),unaccountedShipping:OzonPosting[]=[];
 for(const p of postings){
  if(handled.has(prefix+p.number)||state.shipments.some(s=>s.source==='ozon-fbs'&&s.status==='posted'&&s.ozonClientId===clientId&&s.ozonPostingIds?.includes(p.number)))continue;
  if(['cancelled','canceled','awaiting_registration','not_accepted'].includes(p.status))continue;
  const collecting=p.status==='awaiting_packaging',ready=['awaiting_deliver','acceptance_in_progress','driver_pickup'].includes(p.status)||(['delivering','delivered'].includes(p.status)&&state.shipments.some(s=>s.source==='ozon-fbs'&&s.status==='draft'&&s.ozonClientId===clientId&&s.ozonPostingIds?.includes(p.number)));
  if(!collecting&&!ready){if(p.status==='delivering')unaccountedShipping.push(p);continue;}
  const key=collecting?'collecting':(p.shipmentDate??p.createdAt).slice(0,10)+':'+p.warehouseId;
  groups.set(key,[...(groups.get(key)??[]),p]);
 }
 const existing=state.shipments.filter(s=>s.source==='ozon-fbs'&&s.ozonClientId===clientId&&s.status==='draft');
 for(const s of existing)if(!groups.has(s.ozonGroup??'')){s.lines=[];s.ozonPostingIds=[];s.ozonUnknown=[];}
 for(const [key,ps] of groups){
  let shipment=existing.find(s=>s.ozonGroup===key);const collecting=key==='collecting';
  if(!shipment){shipment={id:'ozon-fbs:'+clientId+':'+key+':'+Date.now(),name:collecting?'Актуальная FBS поставка Ozon':'FBS Ozon · '+key.split(':')[0],channel:'FBS',source:'ozon-fbs',wbFbsStage:collecting?'collecting':'assembly',wbFboStatusId:null,status:'draft',lines:[],postedAt:null,packedToAssembled:false,externalOrderIds:[],canceledExternalOrderIds:[],externalSupplyId:null,wbFbsSupplyId:null,externalUpdatedAt:null,ozonClientId:clientId,ozonGroup:key,ozonPostingIds:[]};state.shipments.push(shipment);}
  const lines=new Map<string,{qty:number;postings:string[];units:{key:string;qty:number}[]}>(),unknown:string[]=[];
  for(const p of ps)for(const x of p.products){
   const mapped=mapping['ozon:'+clientId+':'+x.sku],item=state.items.find(i=>i.stockKind==='finished'&&(mapped?i.id===mapped:i.sku===x.offerId));
   if(!item){unknown.push(x.offerId);continue;}
   const old=lines.get(item.id)??{qty:0,postings:[],units:[]};old.qty+=x.quantity;old.postings.push(p.number);old.units.push({key:fbsUnitKey('ozon',clientId,p.number,x.sku),qty:x.quantity});lines.set(item.id,old);
  }
  shipment.ozonPostingIds=ps.map(p=>p.number).sort();shipment.ozonUnknown=[...new Set(unknown)];
  shipment.lines=[...lines].map(([id,x])=>{return {id:shipment!.id+':'+id,finishedItemId:id,qty:x.qty,...assemblyFields(state,x.units),externalOrderIds:[],ozonPostingIds:[...new Set(x.postings)].sort()};});
 }
 state.shipments=state.shipments.filter(s=>s.source!=='ozon-fbs'||s.status==='posted'||s.lines.length>0||(s.ozonUnknown?.length??0)>0||s.wbFbsStage==='collecting');
 return {changed:before!==JSON.stringify({shipments:state.shipments,assembly:state.fbsAssembly??{},ozonFbs:state.ozonFbs}),unaccountedShipping:unaccountedShipping.map(p=>({number:p.number,status:p.status,createdAt:p.createdAt})).sort((a,b)=>a.number.localeCompare(b.number))};
}

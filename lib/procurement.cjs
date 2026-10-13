'use strict';
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const day=(v,n)=>new Date(Date.parse(v)+n*86400000).toISOString().slice(0,10);
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const DEFAULTS={leadDays:40,safetyDays:7,reviewDays:14};
function settings(value={}){
 const out={...DEFAULTS,...value};
 for(const k of Object.keys(DEFAULTS))if(!Number.isInteger(out[k])||out[k]<(k==='safetyDays'?0:1)||out[k]>365)throw Error('INVALID_SETTINGS');
 return out;
}
function calculate({items,kits,demand,orders=[],config={},today,complete=true}){
 if(!date(today))throw Error('INVALID_DATE');
 const itemMap=new Map(items.map(i=>[i.id,i])),byFinished=new Map(kits.map(k=>[k.finishedItemId,k]));
 const components=new Map(items.filter(i=>i.stockKind==='main').map(i=>[i.id,{id:i.id,name:i.name,sku:i.sku,local:Math.max(0,i.onHand-i.reserved),finished:0,marketplace:0,daily:0,usedBy:[],unknown:false}]));
 const unknown=[];
 for(const d of demand){
  const kit=byFinished.get(d.finishedItemId);
  if(!kit||kit.status!=='ok'||!kit.lines.length){if((d.daily??0)>0||d.daily===null)unknown.push(d.key);continue;}
  if(!finite(d.daily)||!finite(d.stock))throw Error('INVALID_DEMAND');
  for(const line of kit.lines){
   if(!finite(line.qty)||line.qty===0||!itemMap.has(line.componentItemId))throw Error('INVALID_BOM');
   const c=components.get(line.componentItemId);if(!c)continue;
   c.daily+=d.daily*line.qty;c.marketplace+=d.stock*line.qty;
   c.usedBy.push({sku:kit.sku,source:d.source,daily:d.daily*line.qty});
  }
 }
 // Already assembled local units are counted once, regardless of the number of channels.
 for(const kit of kits){if(kit.status!=='ok')continue;const finished=itemMap.get(kit.finishedItemId);if(!finished)continue;
  const units=Math.max(0,finished.onHand-finished.reserved);
  for(const line of kit.lines){const c=components.get(line.componentItemId);if(c)c.finished+=units*line.qty;}
 }
 const rows=[...components.values()].map(c=>{
  const s=settings(config[c.id]),open=orders.filter(o=>o.itemId===c.id&&o.status==='ordered');
  if(open.some(o=>!finite(o.quantity)||!date(o.eta)))throw Error('INVALID_ORDER');
  const stock=c.local+c.finished+c.marketplace,valid=complete&&c.usedBy.length>0;
  const days=c.daily>0?stock/c.daily:null,localDays=c.daily>0?c.local/c.daily:null;
  const deadline=day(today,s.leadDays+s.safetyDays+s.reviewDays);
  const inTime=open.filter(o=>o.eta>=today&&o.eta<=deadline);
  const expected=inTime.reduce((n,o)=>n+o.quantity,0),inbound=open.reduce((n,o)=>n+o.quantity,0);
  // Late arrivals must not hide an earlier stockout.
  let balance=stock,last=today,gap=false;
  for(const o of [...inTime].sort((a,b)=>a.eta.localeCompare(b.eta))){balance-=c.daily*((Date.parse(o.eta)-Date.parse(last))/86400000);if(balance<0)gap=true;balance+=o.quantity;last=o.eta;}
  const late=open.some(o=>o.eta<today);
  const recommended=c.daily>0?Math.max(0,Math.ceil(c.daily*(s.leadDays+s.safetyDays+s.reviewDays)-stock-expected)):0;
  const due=days===null?null:day(today,Math.floor(days-s.leadDays-s.safetyDays));
  const status=!valid?'incomplete':late?'late':gap?'gap':c.daily===0?'no-demand':due<=today&&recommended>0?'order':open.length?'ordered':'enough';
  return {...c,...s,stock,days:valid?days:null,localDays:valid?localDays:null,inbound,recommended:valid?recommended:null,orderBy:valid?due:null,status,complete:valid,orders:open};
 }).sort((a,b)=>(a.days??Infinity)-(b.days??Infinity)||a.name.localeCompare(b.name,'ru'));
 return {rows,unmapped:[...new Set(unknown)]};
}
module.exports={calculate,settings,date,DEFAULTS};

import 'server-only';import path from 'node:path';import fs from 'node:fs';
import {readState} from './store';import {createStore} from './procurement-store.cjs';import {calculate,type Demand} from './procurement.cjs';
export const procurement=createStore(path.join(process.cwd(),'data'));
export async function procurementReport(){const state=readState(),plan=await procurement.read(),today=new Date(Date.now()+10800000).toISOString().slice(0,10);
const input=path.join(process.cwd(),'data','demand-input.json');let demand:Demand[]=[],complete=false,sources:{name:string;period:string;ready:boolean}[]=[];
try{const d=JSON.parse(fs.readFileSync(input,'utf8'));const fresh=Date.now()-Date.parse(d.obtainedAt)>=0&&Date.now()-Date.parse(d.obtainedAt)<2*3600000;
if(d.schemaVersion!==1||!fresh||d.complete!==true||!Array.isArray(d.rows)||!d.sources.every((s:{ready:boolean})=>s.ready))throw Error('INCOMPLETE');demand=d.rows;complete=true;sources=d.sources;}catch{sources=[{name:'История заказов и остатки маркетплейсов',period:'Подключите адаптер спроса по инструкции INTEGRATION.md',ready:false}];}
const report=calculate({items:state.items,kits:state.kits,demand,orders:plan.orders,config:plan.config,today,complete});
const unmapped=demand.filter(d=>!d.finishedItemId).map(d=>({key:d.key,article:d.key,source:d.source}));
return {...report,revision:plan.revision,today,sources,unmapped,kits:state.kits.filter(k=>k.status==='ok').map(k=>({id:k.finishedItemId,sku:k.sku}))};}

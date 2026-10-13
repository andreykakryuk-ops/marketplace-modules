import type {AppState, Shipment, ShipmentLine} from './types';

export type FbsUnit = {key:string;qty:number};
export function fbsUnitKey(marketplace:'wb'|'ozon',cabinet:string,order:string|number,itemId:string){
 return JSON.stringify([marketplace,cabinet,String(order),itemId]);
}
export function rememberAssembly(state:AppState,line:ShipmentLine,units:FbsUnit[]){
 const ledger=state.fbsAssembly??={};
 // Legacy boolean marks can be migrated only when the entire old composition is known.
 const legacyComplete=!line.fbsUnits&&line.assembled&&units.reduce((n,u)=>n+u.qty,0)===line.qty;
 for(const u of line.fbsUnits??units){
  if(!Object.hasOwn(ledger,u.key))ledger[u.key]=legacyComplete?u.qty:0;
  if(line.fbsUnits&&line.assembled)ledger[u.key]=u.qty;
 }
}
export function assemblyFields(state:AppState,units:FbsUnit[]){
 const ledger=state.fbsAssembly??={};
 for(const u of units)if(!Object.hasOwn(ledger,u.key))ledger[u.key]=0;
 const ordered=[...units].sort((a,b)=>a.key.localeCompare(b.key));
 const qty=ordered.reduce((n,u)=>n+u.qty,0);
 const assembledQty=ordered.reduce((n,u)=>n+Math.min(u.qty,Math.max(0,state.fbsAssembly?.[u.key]??0)),0);
 return {fbsUnits:ordered,assembledQty,assembled:qty>0&&assembledQty===qty};
}
export function markFbsAssembly(state:AppState,shipment:Shipment,line:ShipmentLine,assembled:boolean){
 const units=line.fbsUnits??(shipment.source==='wb-fbs'?line.externalOrderIds.map(id=>({key:fbsUnitKey('wb',shipment.wbCabinetId??'legacy',id,line.finishedItemId),qty:1})):[]);
 if(!units.length)return;
 const ledger=state.fbsAssembly??={};
 for(const u of units)ledger[u.key]=assembled?u.qty:0;
 Object.assign(line,assemblyFields(state,units));
}

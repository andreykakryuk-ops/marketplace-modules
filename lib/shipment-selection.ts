import type {Shipment} from './types';

export function shipmentSelectionTokens(shipment:Shipment):string[]{
 if(shipment.source==='wb-fbs')return shipment.externalOrderIds.map(id=>JSON.stringify(['wb',shipment.wbCabinetId??'legacy',String(id)]));
 if(shipment.source==='ozon-fbs')return (shipment.ozonPostingIds??[]).map(id=>JSON.stringify(['ozon',shipment.ozonClientId,id]));
 return [];
}
// Selection belongs to whole cards. A merged card inherits selection if it contains a selected order.
export function resolveShipmentSelection(shipments:Shipment[],ids:string[],tokens:string[]=[]):string[]{
 const direct=new Set(ids),orders=new Set(tokens);
 return shipments.filter(s=>direct.has(s.id)||shipmentSelectionTokens(s).some(k=>orders.has(k))).map(s=>s.id);
}
export function selectedShipmentTokens(shipments:Shipment[],ids:string[]):string[]{
 const selected=new Set(ids);
 return [...new Set(shipments.filter(s=>selected.has(s.id)).flatMap(shipmentSelectionTokens))].sort();
}

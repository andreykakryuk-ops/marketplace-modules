import type {Shipment} from './types';
export function shipmentAllowed(shipment:Pick<Shipment,'source'>,permissions:readonly string[]){
 return permissions.includes(shipment.source==='ozon-fbs'?'ozon.shipments':'shipments');
}

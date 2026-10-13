export type SupplyInboundSnapshot={schemaVersion:1;storeId:string;listComplete:boolean;fetchedAt:string;supplies:Array<Record<string,unknown>>};
export type SupplyInboundProjection={complete:boolean;reason:string|null;fetchedAt:string|null;goodsFetchedAt:string|null;total:number|null;byNmId:Record<string,number>;dispatchedTotal:number|null;dispatchedByNmId:Record<string,number>};
export function mergeSupplyRows<T extends {supplyID?:unknown;preorderID?:unknown}>(pages:T[][]):T[];
export function projectInbound(snapshot:unknown,options:{storeId:string;catalog:Array<{nmId:string|number;vendorCode:string}>;warehouse?:string|null;now?:number;maxAgeMs?:number}):SupplyInboundProjection;
export function replenishment(orders:number|null,stock:number|null,inbound:number|null):number|null;

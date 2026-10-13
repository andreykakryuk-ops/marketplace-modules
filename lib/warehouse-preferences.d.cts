export type WarehouseLayout={order:string[];hidden:string[]};
export type WarehousePreference={revision:number;layout:WarehouseLayout};
export function createWarehousePreferences(options:{directory:string}):{read(user:string):Promise<WarehousePreference>;write(user:string,input:{layout:unknown;expectedRevision:number}):Promise<WarehousePreference>};

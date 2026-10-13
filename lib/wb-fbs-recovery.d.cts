export const MAX_RECOVERY_RESPONSE_BYTES:number;
export function parseRecoveryResponse(raw:string):{next:string;orders:unknown[]};
export function readRecoveryResponse(response:Response):Promise<{next:string;orders:unknown[]}>;
export function collectRecoveryOrders(request:(query:{dateFrom:number;dateTo:number;limit:number;next:string})=>Promise<unknown>,start:number,end:number):Promise<{id:number;article:string}[]>;

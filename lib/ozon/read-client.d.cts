export function createReadClient(options:{clientId:string;apiKey:string;request?:typeof fetch}):(endpoint:string,body?:unknown)=>Promise<unknown>;
export function accessSummary(data:unknown,now?:number):{expiresAt:string|null;capabilities:{fbs:boolean;stocks:boolean;finance:boolean}};

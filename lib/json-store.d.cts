export function readJson(file:string,maxBytes?:number):Promise<unknown>;
export function atomic(file:string,value:unknown):Promise<void>;
export function exclusive<T>(key:string,action:()=>Promise<T>):Promise<T>;

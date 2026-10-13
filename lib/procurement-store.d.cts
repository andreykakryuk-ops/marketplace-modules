import type {Item,Kit} from './types';
import type {Config,Order} from './procurement.cjs';
export interface PlanState {revision:number;config:Record<string,Config>;mapping:Record<string,string>;orders:Order[];audit:unknown[]}
export interface Change {kind:string;itemId?:string;leadDays?:number;safetyDays?:number;reviewDays?:number;quantity?:number;eta?:string;orderId?:string;status?:string;key?:string;finishedItemId?:string}
export function createStore(directory:string):{read():Promise<PlanState>;change(actor:{id:string;allowed:boolean},revision:number,input:Change,items:Item[],kits:Kit[]):Promise<PlanState>};

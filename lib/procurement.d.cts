import type {Item,Kit} from './types';
export interface Config {leadDays:number;safetyDays:number;reviewDays:number}
export interface Order {id:string;itemId:string;quantity:number;eta:string;status:'ordered'|'received'|'cancelled';createdAt:string;actor:string}
export interface Demand {key:string;source:string;finishedItemId:string|null;daily:number;stock:number}
export interface Row extends Config {id:string;name:string;sku:string;local:number;finished:number;marketplace:number;daily:number;usedBy:{sku:string;source:string;daily:number}[];stock:number;days:number|null;localDays:number|null;inbound:number;recommended:number|null;orderBy:string|null;status:string;complete:boolean;orders:Order[]}
export function calculate(input:{items:Item[];kits:Kit[];demand:Demand[];orders:Order[];config:Record<string,Config>;today:string;complete:boolean}):{rows:Row[];unmapped:string[]};
export function settings(value?:Partial<Config>):Config;
export function date(value:unknown):boolean;
export const DEFAULTS:Config;

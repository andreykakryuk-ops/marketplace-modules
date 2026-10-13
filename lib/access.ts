import 'server-only';
import path from 'node:path';
import {readJson,atomic,exclusive} from './json-store.cjs';
import type {AppUser} from './types';
export const ACCESS_SECTIONS=[['warehouse','Склад'],['warehouse.procurement','Планирование закупок'],['warehouse.adjust','Ручная правка остатков'],['shipments','Поставки WB и склад'],['ozon.shipments','Поставки Ozon'],['receipt','Приход'],['kits','Комплекты'],['history','История']] as const;
export type Permission = typeof ACCESS_SECTIONS[number][0];
type AccessState={schemaVersion?:number;revision:number;users:Record<string,Permission[]>};
const file=path.join(process.cwd(),'data','section-access.json');
const defaults:Permission[]=['warehouse','shipments','ozon.shipments','receipt','kits','history'];
export async function readAccess():Promise<AccessState>{
 try {const data=await readJson(file,1024*1024) as AccessState;
  if(!Number.isSafeInteger(data.revision)||data.revision<0||!data.users||Array.isArray(data.users)||typeof data.users!=='object'||Object.values(data.users).some(v=>!Array.isArray(v)||v.some(p=>!ACCESS_SECTIONS.some(([key])=>key===p))))throw Error('INVALID_ACCESS');
  return data;
 }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {revision:0,users:{}};throw error;}
}
export function permissionsFor(user:AppUser,state:AccessState):Permission[]{return user.role==='admin'?ACCESS_SECTIONS.map(([key])=>key):state.users[user.id]??defaults;}
export async function hasAccess(user:AppUser,permission:Permission){return permissionsFor(user,await readAccess()).includes(permission);}
export async function saveAccess(actor:AppUser,userId:string,permissions:Permission[],revision:number){
 if(actor.role!=='admin')throw Error('FORBIDDEN');
 if(!userId||userId.length>160||['__proto__','constructor','prototype'].includes(userId)||permissions.some(p=>!ACCESS_SECTIONS.some(([key])=>key===p)))throw Error('INVALID_ACCESS');
 return exclusive(file,async()=>{const state=await readAccess();if(state.revision!==revision)throw Error('REVISION_CONFLICT');const selected=[...new Set(permissions)];if((selected.includes('warehouse.adjust')||selected.includes('warehouse.procurement'))&&!selected.includes('warehouse'))selected.push('warehouse');
  await atomic(file,{schemaVersion:2,revision:state.revision+1,users:{...state.users,[userId]:selected}});
 });
}

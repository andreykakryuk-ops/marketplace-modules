'use server';
import {getSessionUser} from '@/lib/session';import {readState} from '@/lib/store';import {warehousePreferences} from '@/lib/warehouse-preferences';import type {WarehouseLayout} from '@/lib/warehouse-preferences.cjs';
export async function saveWarehouseView(layout:WarehouseLayout,revision:number){
 const user=await getSessionUser({permission:'warehouse'});
 try{const ids=new Set(readState().items.map(i=>i.id));if(!layout||!Array.isArray(layout.order)||!Array.isArray(layout.hidden)||[...layout.order,...layout.hidden].some(id=>!ids.has(id)))throw Error('INVALID_ROWS');
 return {ok:true as const,preferences:await warehousePreferences.write(user.id,{layout,expectedRevision:revision})};}catch{return {ok:false as const,error:'Не удалось сохранить вид склада. Если настройки изменены в другом окне, обновите страницу.'};}
}

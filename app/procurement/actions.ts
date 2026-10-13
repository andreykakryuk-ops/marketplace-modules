'use server';
import {getSessionUser} from '@/lib/session';
import {hasAccess} from '@/lib/access';
import {readState} from '@/lib/store';
import {procurement,procurementReport} from '@/lib/procurement-service';
import type {Change} from '@/lib/procurement-store.cjs';
export async function updateProcurement(revision:number,input:Change){
 const user=await getSessionUser({permission:'warehouse.procurement'}),state=readState();
 try{
  await procurement.change({id:user.id,allowed:await hasAccess(user,'warehouse.procurement')},revision,input,state.items,state.kits);
  return {ok:true as const,report:await procurementReport()};
 }catch(e){return {ok:false as const,error:(e as Error).message==='REVISION_CONFLICT'?'План изменён другим сотрудником. Обновите страницу.':'Не удалось сохранить. Проверьте количество, дату и выбранный товар.'};}
}

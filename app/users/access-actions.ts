'use server';
import {revalidatePath} from 'next/cache';
import {getSessionUser} from '@/lib/session';
import {readState} from '@/lib/store';
import {saveAccess,type Permission} from '@/lib/access';
export async function accessAction(form:FormData){
 const actor=await getSessionUser();
 try{const target=readState().users.find(u=>u.id===String(form.get('userId')));
 if(!target||target.role==='admin')throw Error('FORBIDDEN');
 await saveAccess(actor,target.id,form.getAll('permission').map(String) as Permission[],Number(form.get('revision')));
 revalidatePath('/','layout');return {ok:true};
 }catch(error){return {ok:false,error:(error as Error).message==='REVISION_CONFLICT'?'Права изменились. Обновите страницу.':'Не удалось сохранить права доступа.'};}
}

import {ACCESS_SECTIONS,permissionsFor,readAccess} from '@/lib/access';
import {accessAction} from '@/app/users/access-actions';
import {AnalyticsForm} from './analytics/AnalyticsForm';
import type {AppUser} from '@/lib/types';
export async function AccessPanel({users}:{users:AppUser[]}){
 const state=await readAccess();
 return <section className="analytics an-panel access-panel"><h2>Доступ к разделам</h2><p>Ручная правка остатков закрыта по умолчанию. Допуск открывает только количество, с записью автора в истории. Управление сотрудниками и API доступно только администратору.</p>
 {users.filter(u=>u.role!=='admin').map(u=><AnalyticsForm key={u.id} action={accessAction}><input type="hidden" name="revision" value={state.revision}/><input type="hidden" name="userId" value={u.id}/><h3>{u.name}</h3><p>Отметьте разделы, которые доступны сотруднику. Изменение применяется при следующем действии, в том числе в уже открытых вкладках.</p><div className="access-permissions" key={state.revision}>{ACCESS_SECTIONS.map(([key,label])=><label className="access-permission" key={key}><input type="checkbox" name="permission" value={key} defaultChecked={permissionsFor(u,state).includes(key)}/>{label}</label>)}<button>Сохранить доступ</button></div></AnalyticsForm>)}</section>;
}

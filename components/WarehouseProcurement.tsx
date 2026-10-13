'use client';
import {createContext,useContext,useState,useEffect,useMemo,useCallback,type ReactNode} from 'react';
import {updateProcurement} from '@/app/procurement/actions';
import type {procurementReport} from '@/lib/procurement-service';
import type {Row} from '@/lib/procurement.cjs';
import '@/app/procurement/procurement.css';
type Report=Awaited<ReturnType<typeof procurementReport>>;
const labels:Record<string,string>={incomplete:'Нужны данные',late:'Поставка опаздывает',gap:'Закончится до прихода',order:'Пора заказать',ordered:'Заказано',enough:'Запас достаточен','no-demand':'Нет заказов'};
const num=(n:number|null)=>n===null?'—':n.toLocaleString('ru-RU',{maximumFractionDigits:1});
const Context=createContext<{report:Report|null;rows:Map<string,Row>;edit:(r:Row)=>void;busy:boolean;canEdit:boolean}|null>(null);
export function WarehouseProcurement({initial,refreshKey='',canEdit,children}:{initial:Report|null;refreshKey?:string;canEdit:boolean;children:ReactNode}){
 const [snapshot,setSnapshot]=useState({key:refreshKey,value:initial}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState<Row|null>(null);
 const report=snapshot.key===refreshKey?snapshot.value:null;
 const setReport=useCallback((value:Report|null)=>setSnapshot({key:refreshKey,value}),[refreshKey]);
 const loading=report===null;
 useEffect(()=>{
  if(initial!==null)return;
  const controller=new AbortController();let active=true;
  fetch('/api/warehouse/procurement',{cache:'no-store',signal:controller.signal})
   .then(async response=>{if(!response.ok)throw Error('LOAD_FAILED');return response.json() as Promise<Report>;})
   .then(value=>{if(active){setReport(value);setError('');}})
   .catch(()=>{if(active)setError('Не удалось обновить расчёт закупок. Остатки доступны; обновите страницу для повтора.');})
;
  return()=>{active=false;controller.abort();};
 },[initial,refreshKey,setReport]);
 const rows=useMemo(()=>new Map((report?.rows??[]).map(row=>[row.id,row])),[report]);
 async function save(input:Parameters<typeof updateProcurement>[1]){
  if(!canEdit||!report)return;setBusy(true);setError('');
  try{const result=await updateProcurement(report.revision,input);if(result.ok){setReport(result.report);setEditing(null);}else setError(result.error);}catch{setError('Не удалось сохранить. Повторите после обновления страницы.');}finally{setBusy(false);}
 }
 return <Context.Provider value={{report,rows,edit:setEditing,busy:busy||loading,canEdit}}>
 {children}{report?.sources.some(s=>!s.ready)?<p role="status">Расчёт ожидает источник: {report.sources.filter(s=>!s.ready).map(s=>s.name+' — '+s.period).join('; ')}.</p>:null}{report?.unmapped.length?<p className="an-note">Расход рассчитан по связанным комплектам. Несопоставленные артикулы не включены в расход компонентов; создайте для них отдельные комплекты или укажите связь ниже.</p>:null}{error?<p role="alert">{error}</p>:null}
  {canEdit&&report&&report.unmapped.length?<details className="procurement-mapping"><summary>Сопоставить артикулы с комплектами ({report.unmapped.length})</summary><table><thead><tr><th>Магазин</th><th>Артикул</th><th>Комплект склада</th></tr></thead><tbody>{report.unmapped.map(x=><tr key={x.key}><td>{x.source}</td><td>{x.article}</td><td><select aria-label={'Комплект для '+x.article} defaultValue="" disabled={busy} onChange={e=>{if(e.target.value)void save({kind:'mapping',key:x.key,finishedItemId:e.target.value});}}><option value="">Выбрать комплект</option>{report.kits.map(k=><option key={k.id} value={k.id}>{k.sku}</option>)}</select></td></tr>)}</tbody></table></details>:null}
  {editing&&report?<div className="an-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setEditing(null);}}><section className="procurement-dialog" role="dialog" aria-modal="true" aria-label={'Закупка '+editing.name} onKeyDown={e=>{if(e.key==='Escape'&&!busy)setEditing(null);}}><header><strong>{editing.name}</strong><button disabled={busy} onClick={()=>setEditing(null)} aria-label="Закрыть закупку">×</button></header><div className="procurement-dialog-body">
 <form id="procurement-order" action={async data=>save({kind:'order',itemId:editing.id,quantity:Number(data.get('quantity')),eta:String(data.get('eta'))})}><label>Заказано, шт.<input name="quantity" type="number" min="1" max="10000000" step="1" required defaultValue={editing.recommended??''}/></label><label>Ожидаемая дата прихода<input name="eta" type="date" required defaultValue={new Date(Date.parse(report.today)+editing.leadDays*86400000).toISOString().slice(0,10)}/></label></form>
 <details><summary>Срок доставки и резерв</summary><form action={async data=>save({kind:'config',itemId:editing.id,leadDays:Number(data.get('leadDays')),safetyDays:Number(data.get('safetyDays')),reviewDays:Number(data.get('reviewDays'))})}>{([['leadDays','Доставка, дней'],['safetyDays','Страховой запас, дней'],['reviewDays','Партия дополнительно на, дней']] as const).map(([key,label])=><label key={key}>{label}<input name={key} type="number" min={key==='safetyDays'?0:1} max="365" required defaultValue={editing[key]}/></label>)}<button disabled={busy}>Сохранить сроки</button></form></details>
 {editing.orders.map(o=><div key={o.id} className="procurement-order"><span>{num(o.quantity)} шт. · ожидается {o.eta}</span><button disabled={busy} title="Снимает отметку в пути. Остаток оформите в разделе Приход." onClick={()=>{if(window.confirm('Приход уже оформлен на складе? Эта кнопка только снимает отметку «В пути», остатки не увеличивает.'))void save({kind:'close',orderId:o.id,status:'received'});}}>Получено</button><button disabled={busy} onClick={()=>void save({kind:'close',orderId:o.id,status:'cancelled'})}>Отменить заказ</button></div>)}
 </div><footer><button type="submit" form="procurement-order" disabled={busy}>Сохранить «Заказано»</button><button disabled={busy} onClick={()=>setEditing(null)}>Закрыть</button></footer></section></div>:null}
 </Context.Provider>;
}
export const procurementColumns=[['marketplace','На маркетплейсах'],['daily','Расход в день'],['days','Хватит на дней'],['inbound','В пути из Китая'],['ordered','Заказано']] as const;
export function ProcurementCells({id}:{id:string}){
 const ctx=useContext(Context),r=ctx?.rows.get(id);
 if(!r)return <>{procurementColumns.map(([key])=><td key={key}>—</td>)}</>;
 return <><td className="num">{r.complete?num(r.marketplace):'—'}</td><td className="num" title={r.complete?'Суммарный расход по составам комплектов WB и Ozon':'Не все источники или связи товаров загружены'}>{r.complete?num(r.daily):'—'}</td><td className={'num procurement-status status-'+r.status} title={labels[r.status]+(r.orderBy?' · заказать до '+r.orderBy:'')}>{num(r.days)}</td><td className="num">{num(r.inbound)}</td><td><button type="button" disabled={!ctx!.canEdit||ctx!.busy} onClick={()=>ctx!.edit(r)}>{r.inbound>0?'✓ Заказано':'Заказано'}</button></td></>;
}

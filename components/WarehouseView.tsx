'use client';
import './warehouse-view.css';
import {createContext,useContext,useState,type ReactNode} from 'react';
import {saveWarehouseView} from '@/app/warehouse-view-actions';
import type {WarehouseLayout,WarehousePreference} from '@/lib/warehouse-preferences.cjs';
import type {Item} from '@/lib/types';
const View=createContext<{layout:WarehouseLayout;busy:boolean;save:(next:WarehouseLayout)=>void}|null>(null);
export function WarehouseView({initial,children}:{initial:WarehousePreference;children:ReactNode}){
 const [saved,setSaved]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(layout:WarehouseLayout){if(busy)return;const previous=saved;setSaved({...saved,layout});setBusy(true);setError('');try{const r=await saveWarehouseView(layout,previous.revision);if(r.ok)setSaved(r.preferences);else{setSaved(previous);setError(r.error);}}catch{setSaved(previous);setError('Не удалось сохранить вид склада. Повторите.');}finally{setBusy(false);}}
 return <View.Provider value={{layout:saved.layout,busy,save}}>{error?<p role="alert">{error}</p>:null}{children}</View.Provider>;
}
export function useWarehouseRows(items:Item[]){
 const view=useContext(View);if(!view)throw Error('Warehouse view missing');
 const {layout,busy,save}=view,index=new Map(layout.order.map((id,i)=>[id,i]));
 const ordered=[...items].sort((a,b)=>(index.get(a.id)??1e9)-(index.get(b.id)??1e9)||a.sortOrder-b.sortOrder);
 const hide=(id:string,hidden:boolean)=>save({...layout,hidden:hidden?[...new Set([...layout.hidden,id])]:layout.hidden.filter(x=>x!==id)});
 const reorder=(ids:string[])=>save({...layout,order:[...ids,...layout.order.filter(id=>!ids.includes(id))]});
 return {rows:ordered.filter(i=>!layout.hidden.includes(i.id)),hidden:ordered.filter(i=>layout.hidden.includes(i.id)),hide,reorder,busy};
}
export function WarehouseRowTools({items}:{items:Item[]}){
 const rows=useWarehouseRows(items);return <details className="warehouse-row-tools"><summary>Строки · скрыто {rows.hidden.length}</summary><div>{items.map(item=><label key={item.id} data-item-id={item.id}><input type="checkbox" disabled={rows.busy} checked={!rows.hidden.some(i=>i.id===item.id)} onChange={e=>rows.hide(item.id,!e.target.checked)}/>{item.sku||item.name}</label>)}</div></details>;
}

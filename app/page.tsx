import {warehouseClientState} from "@/lib/warehouse-client-state";
import {WarehouseProcurement} from '@/components/WarehouseProcurement';
import {readStateRevision} from '@/lib/store';
import {WarehouseView} from '@/components/WarehouseView';
import {warehousePreferences} from '@/lib/warehouse-preferences';
import {hasAccess} from '@/lib/access';
import { readState } from "@/lib/store";
import { WarehouseSheet } from "@/components/WarehouseSheet";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const state = readState();
  const user = await getSessionUser({permission:'warehouse'});
  const preferences=await warehousePreferences.read(user.id),ids=new Set(state.items.map(i=>i.id));preferences.layout={order:preferences.layout.order.filter(id=>ids.has(id)),hidden:preferences.revision===0?state.items.filter(i=>i.hidden).map(i=>i.id):preferences.layout.hidden.filter(id=>ids.has(id))};
  return <WarehouseProcurement initial={null} refreshKey={readStateRevision()} canEdit={await hasAccess(user,'warehouse.procurement')}><WarehouseView initial={preferences}><WarehouseSheet state={warehouseClientState(state)} user={user} canAdjustStock={await hasAccess(user,'warehouse.adjust')} canPlanPurchases={await hasAccess(user,'warehouse.procurement')} /></WarehouseView></WarehouseProcurement>;
}

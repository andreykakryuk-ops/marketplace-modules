import {warehouseClientState} from "@/lib/warehouse-client-state";
import {shipmentReservationView} from '@/lib/bom';
import {permissionsFor,readAccess} from "@/lib/access";
import {shipmentAllowed} from "@/lib/shipment-access";
import {redirect} from "next/navigation";
import { ShipmentPanel, type ShipmentTab } from "@/components/ShipmentPanel";
import { getSessionUser } from "@/lib/session";
import { readState } from "@/lib/store";
import { isAdmin } from "@/lib/types";
import { readShipmentStatus } from "@/lib/shipment-status";
import { activeShipments } from "@/lib/shipment-lifecycle";

export const dynamic = "force-dynamic";

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getSessionUser();
  const permissions=permissionsFor(user,await readAccess());
  if(!permissions.includes('shipments')&&!permissions.includes('ozon.shipments'))redirect('/no-access');
  const { tab: rawTab } = await searchParams;
  const tab: ShipmentTab = !permissions.includes('shipments')?'fbs':rawTab === "stock" ? "stock" : rawTab === "fbo" ? "fbo" : "fbs";
  const state = readState();
  const status = readShipmentStatus();
  const visibleShipments=activeShipments(state).filter(s=>shipmentAllowed(s,permissions));
  return (
    <ShipmentPanel
      state={{ ...warehouseClientState(state), shipmentReservationView:shipmentReservationView(state,visibleShipments), shipments:visibleShipments }}
      admin={isAdmin(user)}
      tab={tab}
      refreshKey={status.refreshKey}
      canManageWb={permissions.includes('shipments')}
    />
  );
}

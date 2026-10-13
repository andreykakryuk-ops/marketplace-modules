import {warehouseClientState} from "@/lib/warehouse-client-state";
import { KitsPanel } from "@/components/KitsPanel";
import { getSessionUser } from "@/lib/session";
import { readState } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function KitsPage() {
  const state = readState();
  await getSessionUser({permission:'kits'});
  return <KitsPanel state={warehouseClientState(state)} />;
}

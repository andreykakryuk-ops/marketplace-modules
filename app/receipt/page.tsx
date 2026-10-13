import {warehouseClientState} from "@/lib/warehouse-client-state";
import { ReceiptForm } from "@/components/ReceiptForm";
import { getSessionUser } from "@/lib/session";
import { readState } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ReceiptPage() {
  await getSessionUser({permission:'receipt'});
  const state = readState();
  return (
    <div className="page-flow" style={{ padding: 16, maxWidth: 1080 }}>

      <ReceiptForm state={warehouseClientState(state)} />
    </div>
  );
}

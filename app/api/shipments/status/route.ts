import { getLoginAccount } from "@/lib/auth";
import {hasAccess} from "@/lib/access";
import { readSessionUser } from "@/lib/session";
import { readShipmentStatus } from "@/lib/shipment-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await readSessionUser();
  if (!user || getLoginAccount(user.id)?.mustChangePassword) {
    return Response.json({ error: "Требуется вход" }, { status: 401 });
  }
  // Только чтение локального статуса. Обращения к WB выполняет серверный планировщик.
  if (!(await hasAccess(user,"shipments"))&&!(await hasAccess(user,"ozon.shipments"))) return Response.json({error:"Нет доступа"},{status:403});
  const { refreshKey } = readShipmentStatus();
  return Response.json({ refreshKey }, { headers: { "Cache-Control": "no-store" } });
}

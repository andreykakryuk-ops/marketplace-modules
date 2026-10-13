import type { AppState, Shipment } from "@/lib/types";

// Older releases emptied manual shipments after posting. Hide only proven completed
// shells in the active view; keep the stored data and genuine empty drafts untouched.
export function activeShipments(state: Pick<AppState, "shipments" | "shipmentDocuments">): Shipment[] {
  const completedIds = new Set(state.shipmentDocuments.map((document) => document.shipmentId));
  return state.shipments.filter((shipment) =>
    !(shipment.source === "manual" && shipment.lines.length === 0 &&
      shipment.externalOrderIds.length === 0 && completedIds.has(shipment.id)),
  );
}

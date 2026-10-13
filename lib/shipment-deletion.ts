import type { Shipment } from "@/lib/types";

// Compare the exact card the administrator confirmed with the current server state.
export function shipmentDeletionSnapshot(shipment: Shipment): string {
  return JSON.stringify([
    shipment.id, shipment.name, shipment.channel, shipment.source, shipment.status,
    shipment.wbFbsStage, shipment.wbFbsSupplyId,shipment.ozonClientId,shipment.ozonPostingIds,shipment.ozonUnknown,
    shipment.externalOrderIds, shipment.canceledExternalOrderIds,
    shipment.lines.map((line) => [
      line.id, line.finishedItemId, line.qty, line.assembled, line.externalOrderIds,
    ]),
  ]);
}

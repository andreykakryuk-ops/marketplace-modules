import { normalizeState } from "@/lib/store";
import { DEFAULT_LAYOUT, DEFAULT_USERS, type AppState } from "@/lib/types";

export function fulfillmentState(componentQty = 100): AppState {
  return normalizeState({
    importedAt: "2026-09-07T12:00:00.000Z",
    sourceFile: "test",
    items: [
      {
        id: "main:component",
        sku: "component",
        name: "Комплектующая",
        stockKind: "main",
        category: "other",
        strapSize: null,
        cost: 10,
        lastPurchaseCost: 10,
        needsReview: false,
        onHand: componentQty,
        reserved: 0,
        sortOrder: 0,
        hidden: false,
      },
      {
        id: "fin:SKU-A",
        sku: "SKU-A",
        name: "SKU-A",
        stockKind: "finished",
        category: "finished",
        strapSize: null,
        cost: 10,
        lastPurchaseCost: 10,
        needsReview: false,
        onHand: 50,
        reserved: 0,
        sortOrder: 1,
        hidden: false,
      },
    ],
    kits: [
      {
        finishedItemId: "fin:SKU-A",
        sku: "SKU-A",
        status: "ok",
        lines: [{ componentItemId: "main:component", qty: 1 }],
      },
    ],
    shipments: [
      {
        id: "shipment-1",
        name: "Поставка 150",
        channel: "FBW",
        source: "manual",
        wbFbsStage: null,
        status: "draft",
        lines: [
          {
            id: "line-1",
            finishedItemId: "fin:SKU-A",
            qty: 150,
            assembled: true,
            externalOrderIds: [],
          },
        ],
        postedAt: null,
        packedToAssembled: false,
        externalOrderIds: [],
        canceledExternalOrderIds: [],
        wbFboStatusId: null,
        externalSupplyId: null,
        wbFbsSupplyId: null,
        externalUpdatedAt: null,
      },
    ],
    shipmentDocuments: [],
    wbFbs: { handledOrderIds: [] },
    wbFbo: { handledSupplyIds: [] },
    receipts: [],
    movements: [],
    users: DEFAULT_USERS,
    layout: DEFAULT_LAYOUT,
  });
}

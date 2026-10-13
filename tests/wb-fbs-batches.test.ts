import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWbFbsShipmentSync,
  normalizeState,
  WB_FBS_SHIPMENT_NAME,
} from "@/lib/store";
import { DEFAULT_LAYOUT, DEFAULT_USERS, type AppState } from "@/lib/types";

function testState(): AppState {
  return normalizeState({
    importedAt: "2026-09-07T12:00:00.000Z",
    sourceFile: "test",
    items: [
      {
        id: "fin:SKU-A",
        sku: "SKU-A",
        name: "SKU-A",
        stockKind: "finished",
        category: "finished",
        strapSize: null,
        cost: 100,
        lastPurchaseCost: 100,
        needsReview: false,
        onHand: 0,
        reserved: 0,
        sortOrder: 0,
        hidden: false,
      },
    ],
    kits: [],
    shipments: [
      {
        id: "active",
        name: WB_FBS_SHIPMENT_NAME,
        channel: "FBS",
        source: "wb-fbs",
        wbFbsStage: "collecting",
        status: "draft",
        lines: [
          {
            id: "line-a",
            finishedItemId: "fin:SKU-A",
            qty: 2,
            assembled: false,
            externalOrderIds: [1, 2],
          },
        ],
        postedAt: null,
        packedToAssembled: false,
        externalOrderIds: [1, 2],
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

test("фиксирует партию при confirm и не переносит её новые заказы в следующую", () => {
  const state = testState();

  const result = applyWbFbsShipmentSync(
    state,
    [
      { id: 2, article: "SKU-A" },
      { id: 3, article: "SKU-A" },
    ],
    [
      { id: 1, supplierStatus: "confirm", wbStatus: "waiting" },
      { id: 2, supplierStatus: "new", wbStatus: "waiting" },
      { id: 3, supplierStatus: "new", wbStatus: "waiting" },
    ],
  );

  const active = state.shipments.find((shipment) => shipment.wbFbsStage === "collecting");
  const assembly = state.shipments.find((shipment) => shipment.wbFbsStage === "assembly");

  assert.equal(result.changed, true);
  assert.deepEqual(active?.externalOrderIds, [3]);
  assert.deepEqual(assembly?.externalOrderIds, [1, 2]);
  assert.match(assembly?.name ?? "", /^FBS на сборке · /);
});

test("автоматически удаляет отменённый заказ из зафиксированной партии", () => {
  const state = testState();
  applyWbFbsShipmentSync(
    state,
    [{ id: 3, article: "SKU-A" }],
    [
      { id: 1, supplierStatus: "confirm", wbStatus: "waiting" },
      { id: 2, supplierStatus: "new", wbStatus: "waiting" },
      { id: 3, supplierStatus: "new", wbStatus: "waiting" },
    ],
  );

  applyWbFbsShipmentSync(
    state,
    [{ id: 3, article: "SKU-A" }],
    [
      { id: 1, supplierStatus: "complete", wbStatus: "sorted" },
      { id: 2, supplierStatus: "cancel", wbStatus: "declined_by_client" },
      { id: 3, supplierStatus: "new", wbStatus: "waiting" },
    ],
  );

  const assembly = state.shipments.find((shipment) => shipment.wbFbsStage === "assembly");
  assert.deepEqual(assembly?.externalOrderIds, [1]);
  assert.deepEqual(assembly?.lines[0]?.externalOrderIds, [1]);
  assert.equal(assembly?.lines[0]?.qty, 1);
  assert.deepEqual(assembly?.canceledExternalOrderIds, []);
  assert.deepEqual(state.wbFbs.handledOrderIds, [2]);
});

test("разбивает зафиксированную FBS-сборку, если заказы разнесли по поставкам WB", () => {
  const state = testState();
  applyWbFbsShipmentSync(
    state,
    [
      { id: 1, article: "SKU-A" },
      { id: 2, article: "SKU-A" },
      { id: 3, article: "SKU-A" },
      { id: 4, article: "SKU-A" },
    ],
    [
      { id: 1, supplierStatus: "new", wbStatus: "waiting" },
      { id: 2, supplierStatus: "new", wbStatus: "waiting" },
      { id: 3, supplierStatus: "new", wbStatus: "waiting" },
      { id: 4, supplierStatus: "new", wbStatus: "waiting" },
    ],
  );
  applyWbFbsShipmentSync(
    state,
    [],
    [
      { id: 1, supplierStatus: "confirm", wbStatus: "waiting" },
      { id: 2, supplierStatus: "confirm", wbStatus: "waiting" },
      { id: 3, supplierStatus: "confirm", wbStatus: "waiting" },
      { id: 4, supplierStatus: "confirm", wbStatus: "waiting" },
    ],
  );

  const before = state.shipments.find((shipment) => shipment.wbFbsStage === "assembly");
  assert.deepEqual(before?.externalOrderIds, [1, 2, 3, 4]);

  applyWbFbsShipmentSync(
    state,
    [],
    [
      { id: 1, supplierStatus: "confirm", wbStatus: "waiting" },
      { id: 2, supplierStatus: "confirm", wbStatus: "waiting" },
      { id: 3, supplierStatus: "confirm", wbStatus: "waiting" },
      { id: 4, supplierStatus: "confirm", wbStatus: "waiting" },
    ],
    [
      { supplyId: "WB-GI-3", orderIds: [2, 3, 4] },
      { supplyId: "WB-GI-1", orderIds: [1] },
    ],
  );

  const assemblies = state.shipments
    .filter((shipment) => shipment.wbFbsStage === "assembly")
    .sort((a, b) => (b.externalOrderIds.length ?? 0) - (a.externalOrderIds.length ?? 0));
  const collecting = state.shipments.find((shipment) => shipment.wbFbsStage === "collecting");

  assert.equal(assemblies.length, 2);
  assert.deepEqual(assemblies[0]?.externalOrderIds, [2, 3, 4]);
  assert.equal(assemblies[0]?.wbFbsSupplyId, "WB-GI-3");
  assert.equal(assemblies[0]?.lines[0]?.qty, 3);
  assert.deepEqual(assemblies[1]?.externalOrderIds, [1]);
  assert.equal(assemblies[1]?.wbFbsSupplyId, "WB-GI-1");
  assert.equal(assemblies[1]?.lines[0]?.qty, 1);
  assert.deepEqual(collecting?.externalOrderIds, []);
  assert.deepEqual(state.wbFbs.handledOrderIds, []);
});

test("WB preserves 4 assembled orders through split 1+3 and merge without marking new orders",()=>{
 const state=testState();state.shipments[0].lines[0].qty=4;state.shipments[0].lines[0].externalOrderIds=[1,2,3,4];state.shipments[0].externalOrderIds=[1,2,3,4];state.shipments[0].lines[0].assembled=true;
 const statuses=[1,2,3,4].map(id=>({id,supplierStatus:"confirm",wbStatus:"waiting"}));
 applyWbFbsShipmentSync(state,[],statuses,[{supplyId:"a",orderIds:[1]},{supplyId:"b",orderIds:[2,3,4]}]);
 const ready=state.shipments.filter(s=>s.wbFbsStage==="assembly");assert.equal(ready.length,2);assert.deepEqual(ready.map(s=>s.lines[0].assembledQty).sort(),[1,3]);assert.ok(ready.every(s=>s.lines[0].assembled));
 const restored=normalizeState(JSON.parse(JSON.stringify(state)));
 applyWbFbsShipmentSync(restored,[{id:5,article:"SKU-A"}],[...statuses,{id:5,supplierStatus:"new",wbStatus:"waiting"}],[{supplyId:"merged",orderIds:[1,2,3,4]}]);
 const merged=restored.shipments.find(s=>s.wbFbsStage==="assembly")!;assert.equal(merged.lines[0].assembledQty,4);assert.equal(merged.lines[0].assembled,true);
 const next=restored.shipments.find(s=>s.wbFbsStage==="collecting")!;assert.equal(next.lines[0].assembled,false);assert.equal(next.lines[0].assembledQty,0);
 assert.equal(restored.items[0].onHand,0);
});

test("восстанавливает впервые увиденный confirm после перерыва без повторного импорта проведённого",()=>{
 const state=testState();state.shipments=[];state.wbFbs.handledOrderIds=[8];
 applyWbFbsShipmentSync(state,[{id:7,article:"SKU-A"},{id:8,article:"SKU-A"}],[{id:7,supplierStatus:"confirm",wbStatus:"waiting"},{id:8,supplierStatus:"confirm",wbStatus:"waiting"}],[],"cabinet");
 const assembly=state.shipments.find(s=>s.wbFbsStage==="assembly")!;
 assert.deepEqual(assembly.externalOrderIds,[7]);assert.equal(assembly.lines[0].qty,1);
 const physical=state.items.map(i=>i.onHand);assembly.lines[0].assembled=true;
 applyWbFbsShipmentSync(state,[{id:7,article:"SKU-A"}],[{id:7,supplierStatus:"confirm",wbStatus:"waiting"}],[],"cabinet");
 assert.equal(state.shipments.filter(s=>s.wbFbsStage==="assembly").length,1);assert.equal(assembly.lines[0].assembled,true);
 assert.deepEqual(state.items.map(i=>i.onHand),physical);
});

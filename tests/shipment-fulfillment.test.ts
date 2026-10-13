import assert from "node:assert/strict";
import test from "node:test";
import { calcNeeds, calcShipmentOverview } from "@/lib/bom";
import { buildHistoryEntries } from "@/lib/history";
import {
  applyReturnedToAssembled,
  applyManualShipmentCreation,
  applyShipmentLineUpdate,
  applyShipmentOperation,
  normalizeState,
} from "@/lib/store";
import { fulfillmentState } from "./fixtures/fulfillment";
import { activeShipments } from "@/lib/shipment-lifecycle";


test("сводка считает комплектующие только после готовых товаров", () => {
  const state = fulfillmentState();
  const needs = calcNeeds(state, state.shipments);

  assert.equal(needs.rows[0]?.needed, 100);
  assert.equal(needs.rows[0]?.onHand, 100);
  assert.equal(needs.rows[0]?.remaining, 0);
  assert.equal(needs.rows[0]?.toBuy, 0);
});

test("пустой выбор поставок не считает сводку", () => {
  const state = fulfillmentState();
  const needs = calcNeeds(state, []);
  assert.equal(needs.rows.length, 0);
  assert.equal(needs.totalBuyCost, 0);
});

test("проведение использует готовые товары и создаёт документ истории", () => {
  const state = fulfillmentState();
  applyShipmentOperation(state, ["shipment-1"], "post", "Тест");

  assert.equal(state.items.find((item) => item.id === "fin:SKU-A")?.onHand, 0);
  assert.equal(state.items.find((item) => item.id === "main:component")?.onHand, 0);
  assert.deepEqual(state.shipmentDocuments[0]?.lines[0], {
    finishedItemId: "fin:SKU-A",
    qty: 150,
    fromFinishedStock: 50,
    assembledForShipment: 100,
    externalOrderIds: [],
  });
  assert.deepEqual(buildHistoryEntries(state).map((entry) => entry.kind), ["shipment"]);
});

test("сборка на склад добавляет всю новую партию сверх готового остатка", () => {
  const state = fulfillmentState(150);
  state.shipments[0].channel = "STOCK";
  applyShipmentOperation(state, ["shipment-1"], "pack", "Тест");

  assert.equal(state.items.find((item) => item.id === "fin:SKU-A")?.onHand, 200);
  assert.equal(state.items.find((item) => item.id === "main:component")?.onHand, 0);
});

test("не проводит поставку при нехватке комплектующих", () => {
  const state = fulfillmentState(99);

  assert.throws(
    () => applyShipmentOperation(state, ["shipment-1"], "post", "Тест"),
    /Не хватает «Комплектующая»: нужно 100, есть 99/,
  );
  assert.equal(state.shipmentDocuments.length, 0);
  assert.equal(state.shipments[0]?.lines.length, 1);
});

test("не меняет количество, пока строка отмечена собранной", () => {
  const state = fulfillmentState();

  assert.throws(
    () => applyShipmentLineUpdate(state, "shipment-1", "line-1", 151, true),
    /Сначала снимите отметку «Собрано»/,
  );

  applyShipmentLineUpdate(state, "shipment-1", "line-1", 150, false);
  applyShipmentLineUpdate(state, "shipment-1", "line-1", 151, false);
  assert.equal(state.shipments[0]?.lines[0]?.qty, 151);
});

test("возврат добавляет готовый комплект в «Собрано на складе»", () => {
  const state = fulfillmentState();
  applyReturnedToAssembled(state, "fin:SKU-A", 2, "Возврат №1", "Тест");

  assert.equal(state.items.find((item) => item.id === "fin:SKU-A")?.onHand, 52);
  assert.equal(state.movements[0]?.reason, "Возврат пригодного к продаже");
  assert.equal(state.movements[0]?.reference, "Возврат №1");
});

test("отдельная комплектующая в поставке списывается со склада без сборки", () => {
  const state = fulfillmentState(8);
  state.shipments[0].name = "Замена ремешка";
  state.shipments[0].lines = [
    {
      id: "line-part",
      finishedItemId: "main:component",
      qty: 2,
      assembled: false,
      externalOrderIds: [],
    },
  ];

  const needs = calcNeeds(state, state.shipments);
  assert.equal(needs.missingKits.length, 0);
  assert.equal(needs.rows[0]?.needed, 2);
  assert.equal(needs.rows[0]?.toBuy, 0);

  applyShipmentOperation(state, ["shipment-1"], "post", "Тест");
  assert.equal(state.items.find((item) => item.id === "main:component")?.onHand, 6);
  assert.equal(state.items.find((item) => item.id === "fin:SKU-A")?.onHand, 50);
});

test("отдельные комплектующие нельзя перенести в склад упакованных", () => {
  const state = fulfillmentState();
  state.shipments[0].channel = "STOCK";
  state.shipments[0].lines = [
    {
      id: "line-part",
      finishedItemId: "main:component",
      qty: 1,
      assembled: false,
      externalOrderIds: [],
    },
  ];

  assert.throws(
    () => applyShipmentOperation(state, ["shipment-1"], "pack", "Тест"),
    /Отдельные часы и ремешки нельзя перенести/,
  );
});

test("FBS-поставку нельзя отправить в склад упакованных", () => {
  const state = fulfillmentState();
  state.shipments[0].channel = "FBS";
  state.shipments[0].source = "wb-fbs";
  state.shipments[0].wbFbsStage = "assembly";
  state.shipments[0].name = "FBS на сборке";

  assert.throws(
    () => applyShipmentOperation(state, ["shipment-1"], "pack", "Тест"),
    /FBS-поставки нельзя отправить в склад упакованных/,
  );
  assert.equal(state.shipmentDocuments.length, 0);
  assert.equal(state.items.find((item) => item.id === "fin:SKU-A")?.onHand, 50);
});

test("не проводит FBS-поставку, которая копит новые заказы", () => {
  const state = fulfillmentState();
  state.shipments[0].source = "wb-fbs";
  state.shipments[0].wbFbsStage = "collecting";
  state.shipments[0].name = "Актуальная FBS поставка";

  assert.throws(
    () => applyShipmentOperation(state, ["shipment-1"], "post", "Тест"),
    /копит новые заказы/,
  );
  assert.equal(state.shipmentDocuments.length, 0);
  assert.equal(state.items.find((item) => item.id === "fin:SKU-A")?.onHand, 50);
});

test("не проводит готовую строку без отметки «Собрано», даже если она уже есть на складе", () => {
  const state = fulfillmentState();
  state.shipments[0].lines[0].qty = 10;
  state.shipments[0].lines[0].assembled = false;

  assert.throws(
    () => applyShipmentOperation(state, ["shipment-1"], "post", "Тест"),
    /Отметьте «Собрано»/,
  );
  assert.equal(state.shipmentDocuments.length, 0);
  assert.equal(state.items.find((item) => item.id === "fin:SKU-A")?.onHand, 50);
});

test("не переносит в упакованные без отметки «Собрано»", () => {
  const state = fulfillmentState();
  state.shipments[0].channel = "STOCK";
  state.shipments[0].lines[0].qty = 10;
  state.shipments[0].lines[0].assembled = false;

  assert.throws(
    () => applyShipmentOperation(state, ["shipment-1"], "pack", "Тест"),
    /Отметьте «Собрано»/,
  );
  assert.equal(state.items.find((item) => item.id === "fin:SKU-A")?.onHand, 50);
});

test("итог «Собрал отмеченных» считает только строки с кнопкой «Собрано»", () => {
  const state = fulfillmentState();
  const marked = calcShipmentOverview(state, state.shipments, state.shipments);
  assert.equal(marked.selectedMarkedAssembled, 150);
  assert.equal(marked.selectedAssembled, 50);
  assert.equal(marked.ready, 1);

  state.shipments[0].lines[0].assembled = false;
  const unmarked = calcShipmentOverview(state, state.shipments, state.shipments);
  assert.equal(unmarked.selectedMarkedAssembled, 0);
  assert.equal(unmarked.selectedAssembled, 50);
  assert.equal(unmarked.ready, 0);
});

test("смешанный выбор collecting и assembly отклоняется целиком", () => {
  for (const operation of ["post", "pack"] as const) {
    const state = fulfillmentState(500);
    const collecting = structuredClone(state.shipments[0]);
    collecting.id = "collecting";
    collecting.channel = "FBS";
    collecting.source = "wb-fbs";
    collecting.wbFbsStage = "collecting";
    state.shipments.push(collecting);
    const before = structuredClone(state);
    assert.throws(() => applyShipmentOperation(state, ["shipment-1", "collecting"], operation, "Тест"), /копит новые заказы/);
    assert.deepEqual(state, before);
  }
});

test("новая сборка не расходует существующие готовые остатки в сводке", () => {
  const state = fulfillmentState(200);
  state.shipments[0].channel = "STOCK";
  const needs = calcNeeds(state, state.shipments);
  assert.equal(needs.rows[0].needed, 150);
  const overview = calcShipmentOverview(state, state.shipments, state.shipments);
  assert.equal(overview.selectedAssembled, 0);
  assert.equal(overview.selectedToAssemble, 150);
  const restored = normalizeState(state);
  assert.equal(restored.shipments[0].channel, "STOCK");
  applyShipmentOperation(restored, ["shipment-1"], "pack", "Тест");
  assert.equal(normalizeState(restored).shipmentDocuments[0].channel, "STOCK");
});

test("операции склада и маркетплейса нельзя подменить прямым вызовом", () => {
  const stock = fulfillmentState(200);
  stock.shipments[0].channel = "STOCK";
  assert.throws(() => applyShipmentOperation(stock, ["shipment-1"], "post", "Тест"), /Добавить в склад/);
  const fbo = fulfillmentState();
  assert.throws(() => applyShipmentOperation(fbo, ["shipment-1"], "pack", "Тест"), /только во вкладке «Склад»/);
});

test("одна неотмеченная строка блокирует всю новую партию", () => {
  const state = fulfillmentState(200);
  state.shipments[0].channel = "STOCK";
  state.shipments[0].lines.push({ ...state.shipments[0].lines[0], id: "unmarked", qty: 1, assembled: false });
  const before = structuredClone(state);
  assert.throws(() => applyShipmentOperation(state, ["shipment-1"], "pack", "Тест"), /Отметьте «Собрано»/);
  assert.deepEqual(state, before);
});

test("нажатие со старым количеством не перезаписывает изменение другого сотрудника", () => {
  const state = fulfillmentState();
  state.shipments[0].lines[0].assembled = false;
  assert.throws(() => applyShipmentLineUpdate(state, "shipment-1", "line-1", 149, true, false), /Строка уже изменена/);
  assert.equal(state.shipments[0].lines[0].qty, 150);
  assert.equal(state.shipments[0].lines[0].assembled, false);
});

test("отметка сборки не даёт права провести collecting", () => {
  const state = fulfillmentState();
  state.shipments[0].source = "wb-fbs";
  state.shipments[0].wbFbsStage = "collecting";
  state.shipments[0].lines[0].assembled = false;
  applyShipmentLineUpdate(state, "shipment-1", "line-1", 150, true);
  assert.throws(() => applyShipmentOperation(state, ["shipment-1"], "post", "Тест"), /копит новые заказы/);
});

test("учитывает общий расход позиции как отдельного товара и комплектующей", () => {
  const state = fulfillmentState(100);
  state.shipments[0].lines.push({ id: "part", finishedItemId: "main:component", qty: 1, assembled: false, externalOrderIds: [] });
  const before = structuredClone(state);
  assert.throws(() => applyShipmentOperation(state, ["shipment-1"], "post", "Тест"), /Не хватает/);
  assert.deepEqual(state, before);
});

test("складская сборка требует комплектующие даже при большом готовом остатке", () => {
  const state = fulfillmentState(149);
  state.shipments[0].channel = "STOCK";
  state.items[1].onHand = 1000;
  const before = structuredClone(state);
  assert.throws(() => applyShipmentOperation(state, ["shipment-1"], "pack", "Тест"), /Не хватает/);
  assert.deepEqual(state, before);
});

test("ручное создание FBS запрещено без изменения состояния", () => {
  const state = fulfillmentState();
  const before = structuredClone(state);
  assert.throws(() => applyManualShipmentCreation(state, "Ручная FBS", "FBS"), /Ручное создание недоступно/);
  assert.deepEqual(state, before);
});

test("ручные FBW, FBO и складские партии по-прежнему создаются", () => {
  for (const channel of ["FBW", "FBO", "STOCK"] as const) {
    const state = fulfillmentState();
    const existing = structuredClone(state.shipments);
    applyManualShipmentCreation(state, "  Новая партия  ", channel);
    assert.equal(state.shipments[0].name, "Новая партия");
    assert.equal(state.shipments[0].channel, channel);
    assert.equal(state.shipments[0].source, "manual");
    assert.equal(state.shipments[0].status, "draft");
    assert.deepEqual(state.shipments.slice(1), existing);
  }
});

test("проведение убирает ручные FBS/FBW/FBO и сборки STOCK целиком, сохраняя документы", () => {
  for (const channel of ["FBS", "FBW", "FBO", "STOCK"] as const) {
    const state = fulfillmentState(200);
    state.shipments[0].channel = channel;
    const completed = structuredClone(state.shipments[0]);
    const untouched = { ...structuredClone(completed), id: "untouched" };
    state.shipments.push(untouched);
    const cost = state.items.map((item) => [item.cost, item.lastPurchaseCost]);
    const operation = channel === "STOCK" ? "pack" : "post";
    applyShipmentOperation(state, [completed.id], operation, "Тест");
    assert.deepEqual(state.shipments, [untouched], channel);
    assert.equal(state.shipmentDocuments[0].shipmentId, completed.id);
    assert.equal(state.shipmentDocuments[0].shipmentName, completed.name);
    assert.equal(state.shipmentDocuments[0].operation, operation);
    assert.equal(state.shipmentDocuments[0].lines[0].qty, 150);
    assert.deepEqual(state.items.map((item) => [item.cost, item.lastPurchaseCost]), cost);
    assert.ok(state.movements.every((movement) => movement.shipmentDocumentId === state.shipmentDocuments[0].id));
    const after = structuredClone(state);
    assert.throws(() => applyShipmentOperation(state, [completed.id], operation, "Тест"), /Поставка не найдена/);
    assert.deepEqual(state, after);
  }
});

test("проведение WB сохраняет обработанные ID даже после удаления карточки", () => {
  for (const source of ["wb-fbs", "wb-fbo"] as const) {
    const state = fulfillmentState();
    Object.assign(state.shipments[0], {
      source, channel: source === "wb-fbs" ? "FBS" : "FBW",
      wbFbsStage: source === "wb-fbs" ? "assembly" : null,
      externalSupplyId: source === "wb-fbo" ? 777 : null,
      externalOrderIds: source === "wb-fbs" ? [11, 12] : [],
    });
    state.shipments[0].lines[0].externalOrderIds = source === "wb-fbs" ? [11, 12, 13] : [];
    state.wbFbs.handledOrderIds = [1];
    state.wbFbo.handledSupplyIds = [2];
    applyShipmentOperation(state, ["shipment-1"], "post", "Тест");
    assert.equal(state.shipments.length, 0);
    assert.deepEqual(state.wbFbs.handledOrderIds, source === "wb-fbs" ? [1, 11, 12, 13] : [1]);
    assert.deepEqual(state.wbFbo.handledSupplyIds, source === "wb-fbo" ? [2, 777] : [2]);
    assert.equal(state.shipmentDocuments[0].lines[0].qty, 150);
  }
});

test("старые пустые завершённые карточки скрыты, новые черновики и collecting остаются", () => {
  const state = fulfillmentState();
  const old = structuredClone(state.shipments[0]);
  applyShipmentOperation(state, [old.id], "post", "Тест");
  old.lines = [];
  const newDraft = { ...structuredClone(old), id: "new-empty" };
  const collecting = {
    ...structuredClone(old), id: "collecting", channel: "FBS" as const,
    source: "wb-fbs" as const, wbFbsStage: "collecting" as const,
  };
  const refilled = { ...structuredClone(old), id: "refilled", lines: fulfillmentState().shipments[0].lines };
  state.shipments = [old, newDraft, collecting, refilled];
  state.shipmentDocuments.push({ ...state.shipmentDocuments[0], id: "old-refilled-doc", shipmentId: refilled.id });
  const before = structuredClone(state);
  assert.deepEqual(activeShipments(state).map((shipment) => shipment.id), ["new-empty", "collecting", "refilled"]);
  assert.deepEqual(state, before);
});

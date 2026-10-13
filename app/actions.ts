"use server";
import {permissionsFor,readAccess,hasAccess,type Permission} from "@/lib/access";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { BlockId, ItemCategory, KitLineInput, Shipment, StockColumnId, WarehouseBlockId } from "@/lib/types";
import {
  createEmployeeWithLogin,
  isAuthRequired,
  removeLoginAccount,
  saveUserLogin,
} from "@/lib/auth";
import { clearSession, createSession, getSessionUser, USER_COOKIE } from "@/lib/session";
import {readState} from "@/lib/store";
import {shipmentAllowed} from "@/lib/shipment-access";
import { parseMoney } from "@/lib/cost";
import {
  addKit,
  clearHistory,
  addShipment,
  addShipmentLine,
  addWarehouseItem,
  deleteKit,
  deleteShipment,
  deleteShipmentLine,
  deleteWarehouseItem,
  moveLayoutBlock,
  moveLayoutColumn,
  packShipmentsToAssembled,
  postShipments,
  receiveBatch,
  redoLast,
  removeEmployee,
  requireAdmin,
  renameUser,
  reorderWarehouseItems,
  reverseMovement,
  saveKit,
  setBlockWidth,
  setBlockTitle,
  setColumnWidth,
  setProjectName,
  setShowHidden,
  addReturnedToAssembled,
  undoLast,
  updateShipmentLine,
  updateWarehouseItem,
} from "@/lib/store";
import { configureWbFbo, disconnectWbFbo, syncWbFbo } from "@/lib/wb-fbo";
import { configureWbFbs, disconnectWbFbs, syncWbFbs } from "@/lib/wb-fbs";

function refresh() {
  revalidatePath("/", "layout");
  revalidatePath("/");
  revalidatePath("/kits");
  revalidatePath("/history");
  revalidatePath("/receipt");
  revalidatePath("/users");
  revalidatePath("/shipments");
}

function fail(error: unknown) {
  return { ok: false as const, error: error instanceof Error ? error.message : "Неизвестная ошибка" };
}

async function actor(permission?: Permission) {
  return getSessionUser({permission});
}

export async function switchUserAction(formData: FormData) {
  if (isAuthRequired()) return;
  const id = String(formData.get("userId") || "");
  const jar = await cookies();
  jar.set(USER_COOKIE, id, { path: "/", sameSite: "lax", httpOnly: false });
  refresh();
}

export async function logoutAction() {
  await clearSession();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function undoAction() {
  try {
    undoLast(await actor());
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function redoAction() {
  try {
    redoLast(await actor());
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function updateKitAction(formData: FormData) {
  const sku = String(formData.get("sku") || "");
  const newSku = String(formData.get("newSku") || sku);
  const componentIds = formData.getAll("componentId").map(String);
  const qtys = formData.getAll("qty").map(String);
  const costs = formData.getAll("cost").map(String);
  const hasCosts = costs.length > 0;
  const lines: KitLineInput[] = [];
  for (let i = 0; i < componentIds.length; i++) {
    const componentItemId = componentIds[i];
    const qty = Math.round(Number(qtys[i]));
    if (!componentItemId || !Number.isFinite(qty) || qty < 1) continue;
    if (lines.some((line) => line.componentItemId === componentItemId)) continue;
    const line: KitLineInput = { componentItemId, qty };
    if (hasCosts) {
      line.lastPurchaseCost = parseMoney(costs[i] ?? "");
    }
    lines.push(line);
  }
  try {
    saveKit(sku, lines.length > 0 ? "ok" : "needs_setup", lines, await actor('kits'), newSku);
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function addKitAction(formData: FormData) {
  const sku = String(formData.get("newSku") || formData.get("sku") || "");
  try {
    addKit(sku, [], await actor('kits'));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteKitAction(formData: FormData) {
  try {
    deleteKit(String(formData.get("sku") || ""), await actor('kits'));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function addItemAction(formData: FormData) {
  try {
    const name = String(formData.get("name") || "");
    const category = String(formData.get("category") || "watch") as ItemCategory;
    const sizeRaw = String(formData.get("strapSize") || "");
    const costRaw = String(formData.get("cost") || "");
    const qtyRaw = String(formData.get("qty") || "");
    const strapSize = category === "strap" ? Number(sizeRaw) : null;
    if (category === "strap" && (!Number.isFinite(strapSize) || (strapSize as number) < 1)) {
      throw new Error("Укажите размер ремешка в миллиметрах, например 21, 38 или 46");
    }
    const cost = costRaw === "" ? null : parseMoney(costRaw);
    const qty = qtyRaw === "" ? 0 : Number(qtyRaw.replace(",", "."));
    addWarehouseItem(
      { name, category, strapSize, cost, qty: Number.isFinite(qty) ? qty : 0 },
      await actor('warehouse'),
    );
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteItemAction(formData: FormData) {
  try {
    deleteWarehouseItem(String(formData.get("id") || ""), await actor('warehouse'));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function reorderItemsAction(orderedIds: string[]) {
  try {
    reorderWarehouseItems(orderedIds, await actor('warehouse'));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function updateItemAction(formData: FormData) {
  try {
    const id = String(formData.get("id") || "");
    const patch: { name?: string; onHand?: number; cost?: number | null; hidden?: boolean; strapSize?: number } = {};
    if (formData.has("name")) patch.name = String(formData.get("name") || "");
    if (formData.has("onHand")) patch.onHand = Number(formData.get("onHand"));
    if (formData.has("cost")) {
      const raw = String(formData.get("cost") ?? "");
      patch.cost = raw === "" ? null : parseMoney(raw);
      if (raw !== "" && patch.cost == null) throw new Error("Себестоимость должна быть числом 0 или больше");
    }
    if (formData.has("hidden")) patch.hidden = String(formData.get("hidden")) === "1";
    if (formData.has("strapSize")) {
      const size = Number(formData.get("strapSize"));
      if (Number.isFinite(size) && size >= 1) patch.strapSize = size;
    }
    const expectedOnHand = formData.has("expectedOnHand") ? Number(formData.get("expectedOnHand")) : undefined;
    if (expectedOnHand !== undefined && (!Number.isInteger(expectedOnHand) || expectedOnHand < 0)) {
      throw new Error("Обновите страницу перед изменением остатка");
    }
    const user = await actor('warehouse');
    // This flag is resolved afresh on the server, never from FormData or client props.
    const canAdjustStock = await hasAccess(user,'warehouse.adjust');
    updateWarehouseItem(id, patch, user, expectedOnHand, canAdjustStock);
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function setColumnWidthAction(key: string, width: number) {
  try {
    setColumnWidth(key, width, await actor('warehouse'));
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function setBlockWidthAction(key: string, width: number) {
  try {
    setBlockWidth(key, width, await actor('warehouse'));
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function setProjectNameAction(formData: FormData) {
  try {
    setProjectName(String(formData.get("projectName") || ""), await actor('warehouse'));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function setBlockTitleAction(formData: FormData) {
  try {
    setBlockTitle(String(formData.get("blockId") || "") as BlockId, String(formData.get("title") || ""), await actor('warehouse'));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function setShowHiddenAction(formData: FormData) {
  try {
    setShowHidden(String(formData.get("showHidden")) === "1", await actor('warehouse'));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function moveBlockAction(formData: FormData) {
  try {
    const id = String(formData.get("id") || "") as WarehouseBlockId;
    const direction = String(formData.get("direction") || "left") === "right" ? "right" : "left";
    moveLayoutBlock(id, direction, await actor('warehouse'));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function moveColumnAction(formData: FormData) {
  try {
    const group = String(formData.get("group") || "watch") === "strap" ? "strap" : "watch";
    const column = String(formData.get("column") || "name") as StockColumnId;
    const direction = String(formData.get("direction") || "left") === "right" ? "right" : "left";
    moveLayoutColumn(group, column, direction, await actor('warehouse'));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function receiveAction(formData: FormData) {
  try {
    const itemIds = formData.getAll("itemId").map(String);
    const qtys = formData.getAll("qty").map(String);
    const costs = formData.getAll("cost").map(String);
    const lines: { itemId: string; qty: number; cost: number | null }[] = [];
    for (let i = 0; i < itemIds.length; i++) {
      if (!itemIds[i]) continue;
      const costRaw = (costs[i] ?? "").replace(",", ".");
      lines.push({
        itemId: itemIds[i],
        qty: Number(String(qtys[i]).replace(",", ".")),
        cost: costRaw === "" ? null : Number(costRaw),
      });
    }
    receiveBatch(lines, await actor('receipt'));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function addShipmentAction(formData: FormData) {
  try {
    const rawChannel = String(formData.get("channel") || "FBO");
    const channel: Shipment["channel"] =
      rawChannel === "STOCK" ? "STOCK" : rawChannel === "FBS" ? "FBS" : rawChannel === "FBW" || rawChannel === "FBY" ? "FBW" : "FBO";
    addShipment(String(formData.get("name") || ""), channel, await actor('shipments'));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function configureWbFbsAction(formData: FormData) {
  try {
    const user = await actor('shipments');
    requireAdmin(user);
    const result = await configureWbFbs(String(formData.get("token") || ""));
    refresh();
    return { ok: true as const, status: result.status };
  } catch (error) {
    return fail(error);
  }
}

export async function syncWbFbsAction() {
  try {
    await actor('shipments');
    const result = await syncWbFbs(true);
    if (!result.ok) throw new Error(result.status.lastError || "Не удалось обновить FBS-заказы");
    refresh();
    return { ok: true as const, status: result.status };
  } catch (error) {
    return fail(error);
  }
}

export async function autoSyncWbFbsAction() {
  try {
    await actor('shipments');
    const result = await syncWbFbs();
    if (result.changed) refresh();
    if (!result.ok) {
      return {
        ok: false as const,
        error: result.status.lastError || "Не удалось обновить FBS-заказы",
        status: result.status,
      };
    }
    return { ok: true as const, changed: result.changed, status: result.status };
  } catch (error) {
    return fail(error);
  }
}

export async function disconnectWbFbsAction() {
  try {
    const user = await actor('shipments');
    requireAdmin(user);
    const status = disconnectWbFbs();
    refresh();
    return { ok: true as const, status };
  } catch (error) {
    return fail(error);
  }
}

export async function configureWbFboAction(formData: FormData) {
  try {
    const user = await actor('shipments');
    requireAdmin(user);
    const result = await configureWbFbo(String(formData.get("token") || ""));
    refresh();
    return { ok: true as const, status: result.status };
  } catch (error) {
    return fail(error);
  }
}

export async function syncWbFboAction() {
  try {
    await actor('shipments');
    const result = await syncWbFbo(true);
    if (!result.ok) throw new Error(result.status.lastError || "Не удалось обновить поставки FBO");
    refresh();
    return { ok: true as const, status: result.status };
  } catch (error) {
    return fail(error);
  }
}

export async function autoSyncWbFboAction() {
  try {
    await actor('shipments');
    const result = await syncWbFbo();
    if (result.changed) refresh();
    if (!result.ok) {
      return {
        ok: false as const,
        error: result.status.lastError || "Не удалось обновить поставки FBO",
        status: result.status,
      };
    }
    return { ok: true as const, changed: result.changed, status: result.status };
  } catch (error) {
    return fail(error);
  }
}

export async function disconnectWbFboAction() {
  try {
    const user = await actor('shipments');
    requireAdmin(user);
    const status = disconnectWbFbo();
    refresh();
    return { ok: true as const, status };
  } catch (error) {
    return fail(error);
  }
}

async function shipmentActor(ids:string[]){
 const user=await actor(),permissions=permissionsFor(user,await readAccess()),state=readState();
 if(!ids.length||ids.some(id=>{const shipment=state.shipments.find(s=>s.id===id);return !shipment||!shipmentAllowed(shipment,permissions);}))throw new Error('Нет доступа к этой поставке');
 return user;
}

export async function deleteShipmentAction(formData: FormData) {
  try {
    deleteShipment(String(formData.get("id") || ""), await shipmentActor([String(formData.get('id')||'')]), String(formData.get("expectedSnapshot") || ""));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function addShipmentLineAction(formData: FormData) {
  try {
    addShipmentLine(
      String(formData.get("shipmentId") || ""),
      String(formData.get("finishedItemId") || ""),
      Number(formData.get("qty")),
      await shipmentActor([String(formData.get('shipmentId')||'')]),
      String(formData.get("skuQuery") || ""),
    );
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function updateShipmentLineAction(formData: FormData) {
  try {
    updateShipmentLine(
      String(formData.get("shipmentId") || ""),
      String(formData.get("lineId") || ""),
      Number(formData.get("qty")),
      String(formData.get("assembled")) === "1",
      await shipmentActor([String(formData.get('shipmentId')||'')]),
      formData.has("expectedAssembled") ? String(formData.get("expectedAssembled")) === "1" : undefined,
    );
    revalidatePath("/shipments");
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteShipmentLineAction(formData: FormData) {
  try {
    deleteShipmentLine(String(formData.get("shipmentId") || ""), String(formData.get("lineId") || ""), await shipmentActor([String(formData.get('shipmentId')||'')]));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function postShipmentsAction(formData: FormData) {
  try {
    const ids = formData.getAll("shipmentId").map(String).filter(Boolean);
    if (ids.length === 0) throw new Error("Выберите хотя бы одну поставку");
    postShipments(ids, await shipmentActor(ids));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function packToAssembledAction(formData: FormData) {
  try {
    const ids = formData.getAll("shipmentId").map(String).filter(Boolean);
    if (ids.length === 0) throw new Error("Выберите хотя бы одну поставку");
    packShipmentsToAssembled(ids, await shipmentActor(ids));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function addReturnedToAssembledAction(formData: FormData) {
  try {
    addReturnedToAssembled(
      String(formData.get("finishedItemId") || ""),
      Number(formData.get("qty")),
      String(formData.get("reference") || "") || null,
      await actor('shipments'),
    );
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function reverseMovementAction(formData: FormData) {
  try {
    reverseMovement(String(formData.get("id") || ""), await actor('history'));
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function addEmployeeAction(formData: FormData) {
  try {
    createEmployeeWithLogin(
      String(formData.get("name") || ""),
      String(formData.get("email") || ""),
      String(formData.get("password") || ""),
      await actor(),
    );
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function saveUserAction(formData: FormData) {
  try {
    const currentActor = await actor();
    const id = String(formData.get("id") || "");
    const name = String(formData.get("name") || "");
    if (!name.trim()) throw new Error("Укажите имя");
    saveUserLogin(
      id,
      String(formData.get("email") || ""),
      String(formData.get("password") || ""),
      currentActor,
    );
    renameUser(id, name, currentActor);
    if (id === currentActor.id) await createSession(id);
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function removeEmployeeAction(formData: FormData) {
  try {
    const id = String(formData.get("id") || "");
    removeEmployee(id, await actor());
    removeLoginAccount(id);
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function clearHistoryAction(expectedSnapshot: string) {
  try {
    clearHistory(await actor('history'), expectedSnapshot);
    refresh();
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

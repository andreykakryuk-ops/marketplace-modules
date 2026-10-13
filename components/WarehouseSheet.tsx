"use client";

import {
  addReturnedToAssembledAction,
  setColumnWidthAction,
  updateItemAction,
} from "@/app/actions";
import {useWarehouseRows,WarehouseRowTools} from "@/components/WarehouseView";
import { KitCompositionPreview } from "@/components/KitCompositionPreview";
import { StockInlineField } from "@/components/StockInlineField";
import { StockBlock } from "@/components/StockBlock";
import { EditableTitle } from "@/components/EditableTitle";
import { SkuPicker } from "@/components/SkuPicker";
import { buildItemUsageIndex } from "@/lib/item-usage";
import { stockValue, unitCostOf } from "@/lib/bom";
import { formatCost, formatQty } from "@/lib/format";
import type { AppState, AppUser, Item, WarehouseBlockId } from "@/lib/types";
import { DEFAULT_BLOCK_TITLES, isAdmin } from "@/lib/types";
import { useSessionDraft } from "@/lib/ui-session";
import { useEffect, useMemo, useRef, useState } from "react";

async function run(action: (data: FormData) => Promise<{ ok: true } | { ok: false; error: string }>, data: FormData) {
  const result = await action(data);
  if (!result.ok) window.alert(result.error);
}

type ReturnDraft = { open: boolean; itemId: string; qty: string; reference: string };
const EMPTY_RETURN: ReturnDraft = { open: false, itemId: "", qty: "", reference: "" };

function sortItems(items: Item[]) {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru"));
}

export function WarehouseSheet({ state, user, canAdjustStock = false }: { state: AppState; user: AppUser; canAdjustStock?: boolean; canPlanPurchases?: boolean }) {
  const admin = isAdmin(user);
  const itemUsages = useMemo(() => buildItemUsageIndex(state.kits), [state.kits]);
  const widths = state.layout.columnWidths;
  const titles = state.layout.blockTitles ?? DEFAULT_BLOCK_TITLES;

  const watches = sortItems(
    state.items.filter((item) => item.stockKind === "main" && item.category !== "strap"),
  );
  const straps = sortItems(state.items.filter((item) => item.category === "strap"));
  const finishedItems = sortItems(
    state.items.filter((item) => item.stockKind === "finished"),
  );
  const assembled = finishedItems.filter((item) => item.onHand > 0);

  const watchValues = useMemo(() => new Map(watches.map((item) => [item.id, stockValue(state, item)])), [state, watches]);
  const strapValues = useMemo(() => new Map(straps.map((item) => [item.id, stockValue(state, item)])), [state, straps]);

  const blocks = useMemo(
    () => ({
      watches: (
        <StockBlock
          title={titles.watches}
          blockId="watches"
          items={watches}
          columns={state.layout.watchColumns}
          columnGroup="watch"
          addCategory="watch"
          admin={admin}
          canAdjustStock={canAdjustStock}
          columnWidths={widths}
          values={watchValues}
          usages={itemUsages}
        />
      ),
      straps: (
        <StockBlock
          title={titles.straps}
          blockId="straps"
          items={straps}
          columns={state.layout.strapColumns}
          columnGroup="strap"
          addCategory="strap"
          admin={admin}
          canAdjustStock={canAdjustStock}
          columnWidths={widths}
          values={strapValues}
          usages={itemUsages}
        />
      ),
      assembled: (
        <AssembledBlock
          title={titles.assembled}
          items={assembled}
          finishedItems={finishedItems}
          admin={admin}
          canAdjustStock={canAdjustStock}
          state={state}
          columnWidths={widths}
        />
      ),
    }),
    [admin, canAdjustStock, assembled, finishedItems, itemUsages, state, strapValues, straps, titles.assembled, titles.straps, titles.watches, watchValues, watches, widths],
  );

  const assembledTotal = useMemo(
    () => assembled.reduce((sum, item) => sum + stockValue(state, item), 0),
    [assembled, state],
  );
  const warehouseTotal =
    [...watchValues.values()].reduce((sum, value) => sum + value, 0) +
    [...strapValues.values()].reduce((sum, value) => sum + value, 0) +
    assembledTotal;

  return (
    <div className="warehouse-page">
      <div className="warehouse-scroll">

        <div className="grid-wrap">
          {state.layout.blockOrder.map((id) => {
            return (
              <div key={id} className="block-slot">

                {blocks[id as WarehouseBlockId]}
              </div>
            );
          })}
        </div>
      </div>
      <div className="warehouse-footer">
        <p className="warehouse-total">Всего на складе: {formatCost(warehouseTotal)} ₽</p>
      </div>
    </div>
  );
}

function AssembledBlock({
  title,
  items,
  finishedItems,
  admin,
  canAdjustStock,
  state,
  columnWidths,
}: {
  title: string;
  items: Item[];
  finishedItems: Item[];
  admin: boolean;
  canAdjustStock: boolean;
  state: AppState;
  columnWidths: Record<string, number>;
}) {
  const personal=useWarehouseRows(items);
  const [local, setLocal] = useState<Record<string, number>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragW = local["assembled:drag"] ?? columnWidths["assembled:drag"] ?? 32;
  const nameW = local["assembled:name"] ?? columnWidths["assembled:name"] ?? 140;
  const qtyW = local["assembled:qty"] ?? columnWidths["assembled:qty"] ?? 48;
  const costW = local["assembled:cost"] ?? columnWidths["assembled:cost"] ?? 108;
  const sumW = local["assembled:sum"] ?? columnWidths["assembled:sum"] ?? 64;
  const actionsW = local["assembled:actions"] ?? columnWidths["assembled:actions"] ?? 56;
  const colPx = [dragW, nameW, qtyW, costW, sumW, actionsW];
  const tableWidth = colPx.reduce((sum, width) => sum + width, 0) || 1;
  const totalQty = items.reduce((sum, item) => sum + item.onHand, 0);
  const totalSum = items.reduce((sum, item) => sum + stockValue(state, item), 0);

  async function dropOn(targetId: string) {
    if (personal.busy || !dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const ids = personal.rows.map((item) => item.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    setDragId(null);
    setOverId(null);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    personal.reorder(ids);
  }

  return (
    <div className="block assembled-block" style={{ width: tableWidth }}>
      <EditableTitle className="block-title" inputClassName="block-title-input" value={title} admin={admin} blockId="assembled" />
      <WarehouseRowTools items={items}/>
      {items.length === 0 ? (
        <p className="hint">Пока пусто. Добавьте возврат или упакованные из поставки.</p>
      ) : (
        <table className="sheet-table resizable-table" style={{ width: tableWidth }}>
          <colgroup>
            {colPx.map((width, index) => (
              <col key={index} style={{ width }} />
            ))}
          </colgroup>
          <thead>
            <tr className="headers">
              {(
                <th title="Перетащите строку за эту точку">
                  ⋮⋮

                </th>
              )}
              <th>
                Артикул
                {admin ? (
                  <AssembledResizer col="assembled:name" width={nameW} onLive={(w) => setLocal((c) => ({ ...c, "assembled:name": w }))} />
                ) : null}
              </th>
              <th>
                Кол-во
                {admin ? (
                  <AssembledResizer col="assembled:qty" width={qtyW} onLive={(w) => setLocal((c) => ({ ...c, "assembled:qty": w }))} />
                ) : null}
              </th>
              <th>
                Средневзв. себес.
                {admin ? (
                  <AssembledResizer col="assembled:cost" width={costW} onLive={(w) => setLocal((c) => ({ ...c, "assembled:cost": w }))} />
                ) : null}
              </th>
              <th>
                Сумма
                {admin ? (
                  <AssembledResizer col="assembled:sum" width={sumW} onLive={(w) => setLocal((c) => ({ ...c, "assembled:sum": w }))} />
                ) : null}
              </th>
              {(
                <th>
                  {admin?<AssembledResizer
                    col="assembled:actions"
                    width={actionsW}
                    min={44}
                    onLive={(w) => setLocal((c) => ({ ...c, "assembled:actions": w }))}
                  />:null}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {personal.rows.map((item) => {
              const unit = unitCostOf(state, item);
              return (
                <tr
                  key={item.id}
                  className={`${dragId === item.id ? "dragging" : ""} ${overId === item.id ? "drag-over" : ""}`}
                  onDragOver={(event) => {
                    if (personal.busy) return;
                    event.preventDefault();
                    setOverId(item.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    void dropOn(item.id);
                  }}
                >
                  {(
                    <td
                      className="drag-handle"
                      draggable={!personal.busy}
                      title="Перетащите строку"
                      onDragStart={(event) => {
                        setDragId(item.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", item.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverId(null);
                      }}
                    >
                      ☰
                    </td>
                  )}
                  <td className="name">
                    <KitCompositionPreview state={state} itemId={item.id}>{item.sku}</KitCompositionPreview>
                  </td>
                  <td className="num">
                    {admin || canAdjustStock ? (
                      <AssembledQtyField item={item} />
                    ) : (
                      formatQty(item.onHand)
                    )}
                  </td>
                  <td className="num">{formatCost(unit)}</td>
                  <td className="num">{formatCost(stockValue(state, item))}</td>
                  {(
                    <td className="row-actions">
                      <button className="icon-btn" type="button" title="Скрыть строку" disabled={personal.busy} onClick={()=>personal.hide(item.id,true)}>–</button>
                      {admin?<form
                        action={(data) => {
                          if (window.confirm(`Убрать «${item.sku}» из собранного на складе?`)) return run(updateItemAction, data);
                        }}
                      >
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="onHand" value="0" />
                        <button className="icon-btn" type="submit" title="Удалить">
                          ×
                        </button>
                      </form>:null}
                    </td>
                  )}
                </tr>
              );
            })}
            <tr>
              <td className="total" />
              <td className="total name">Итого</td>
              <td className="total num">{formatQty(totalQty)}</td>
              <td className="total" />
              <td className="total num">{formatCost(totalSum)}</td>
              <td className="total" />
            </tr>
          </tbody>
        </table>
      )}
      <ReturnedFinishedForm finished={finishedItems} />
    </div>
  );
}

function ReturnedFinishedForm({ finished }: { finished: Item[] }) {
  const [draft, setDraft] = useSessionDraft<ReturnDraft>("stock.return", EMPTY_RETURN);
  const [message, setMessage] = useState("");
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!draft.open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (panelRef.current && target && !panelRef.current.contains(target)) {
        setDraft((current) => ({ ...current, open: false }));
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [draft.open, setDraft]);

  return (
    <section className="returned-finished-panel" ref={panelRef}>
      <button
        type="button"
        onClick={() => {
          setDraft((current) => ({ ...current, open: !current.open }));
          setMessage("");
        }}
        disabled={finished.length === 0}
      >
        Добавить возврат
      </button>
      {draft.open ? (
        <form
          className="add-row returned-finished-form"
          action={async (data) => {
            const result = await addReturnedToAssembledAction(data);
            if (!result.ok) {
              window.alert(result.error);
              return;
            }
            setDraft(EMPTY_RETURN);
            setMessage("Возврат добавлен.");
          }}
        >
          <SkuPicker
            items={finished}
            queryName={null}
            placeholder="Артикул возвращённого комплекта"
            required
            value={draft.itemId}
            onChange={(item) => setDraft((current) => ({ ...current, itemId: item?.id ?? "" }))}
          />
          <input
            name="qty"
            type="text"
            inputMode="numeric"
            placeholder="Количество"
            value={draft.qty}
            onChange={(event) => setDraft((current) => ({ ...current, qty: event.target.value }))}
            required
          />
          <input
            name="reference"
            placeholder="Номер возврата / примечание"
            value={draft.reference}
            onChange={(event) => setDraft((current) => ({ ...current, reference: event.target.value }))}
          />
          <button type="submit" className="primary">
            Добавить в собранные
          </button>
        </form>
      ) : null}
      {message ? <span className="returned-finished-message">{message}</span> : null}
    </section>
  );
}

function AssembledQtyField({ item }: { item: Item }) {
  return <StockInlineField id={item.id} name="onHand" value={String(item.onHand)} number />;
}

function AssembledResizer({
  col,
  width,
  min = 40,
  onLive,
}: {
  col: string;
  width: number;
  min?: number;
  onLive: (width: number) => void;
}) {
  const start = useRef({ x: 0, w: 0 });
  return (
    <span
      className="col-resizer"
      title="Потяните, чтобы изменить ширину"
      onMouseDown={(event) => {
        event.preventDefault();
        start.current = { x: event.clientX, w: width };
        function move(ev: MouseEvent) {
          onLive(Math.max(min, start.current.w + ev.clientX - start.current.x));
        }
        function up(ev: MouseEvent) {
          const next = Math.max(min, start.current.w + ev.clientX - start.current.x);
          onLive(next);
          void setColumnWidthAction(col, next);
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        }
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    />
  );
}

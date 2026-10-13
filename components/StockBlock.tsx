"use client";

import {ProcurementCells,procurementColumns} from '@/components/WarehouseProcurement';
import { useEffect, useRef, useState } from "react";
import { addItemAction, deleteItemAction, setColumnWidthAction } from "@/app/actions";
import {useWarehouseRows,WarehouseRowTools} from "@/components/WarehouseView";
import { ItemUsagePreview } from "@/components/ItemUsagePreview";
import type { ItemUsage } from "@/lib/item-usage";
import { StockInlineField } from "@/components/StockInlineField";
import { EditableTitle } from "@/components/EditableTitle";
import { formatCost, formatQty } from "@/lib/format";
import type { BlockId, Item, ItemCategory, StockColumnId } from "@/lib/types";
import { useSessionDraft } from "@/lib/ui-session";

async function run(action: (data: FormData) => Promise<{ ok: true } | { ok: false; error: string }>, data: FormData) {
  const result = await action(data);
  if (!result.ok) window.alert(result.error);
}

const COL_LABEL: Record<StockColumnId, string> = {
  name: "Модель",
  size: "Размер",
  qty: "Кол-во",
  cost: "Средневзв. себес.",
  sum: "Сумма",
};

const DEFAULT_WIDTHS: Record<string, number> = {
  name: 160,
  size: 72,
  qty: 56,
  cost: 108,
  sum: 72,
  drag: 32,
  actions: 56,
};

type AddStockDraft = { open: boolean; name: string; strapSize: string; qty: string; cost: string };
const EMPTY_ADD_STOCK: AddStockDraft = { open: false, name: "", strapSize: "", qty: "", cost: "" };

export function StockBlock({
  title,
  blockId,
  items,
  columns,
  columnGroup,
  addCategory,
  admin,
  canAdjustStock = false,
  columnWidths,
  values,
  usages,
}: {
  title: string;
  blockId: BlockId;
  items: Item[];
  columns: StockColumnId[];
  columnGroup: "watch" | "strap";
  addCategory?: ItemCategory;
  admin: boolean;
  canAdjustStock?: boolean;
  columnWidths: Record<string, number>;
  values: Map<string, number>;
  usages: Map<string, ItemUsage[]>;
}) {
  const personal=useWarehouseRows(items);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [localWidths, setLocalWidths] = useState<Record<string, number>>({});
  const [add, setAdd] = useSessionDraft<AddStockDraft>(
    addCategory ? `stock.add.${addCategory}` : "stock.add.none",
    EMPTY_ADD_STOCK,
  );
  const addRef = useRef<HTMLDivElement>(null);

  function widthOf(col: string) {
    const key = `${columnGroup}:${col}`;
    return localWidths[key] ?? columnWidths[key] ?? DEFAULT_WIDTHS[col] ?? 72;
  }

  const dragWidth = widthOf("drag");
  const actionsWidth = widthOf("actions");
  const colPx = [
    dragWidth,
    ...columns.map((col) => widthOf(col)),
    ...procurementColumns.map(()=>96),
    actionsWidth,
  ];
  const tableWidth = colPx.reduce((sum, width) => sum + width, 0) || 1;
  const totalQty = items.reduce((sum, item) => sum + item.onHand, 0);
  const totalSum = items.reduce((sum, item) => sum + (values.get(item.id) ?? 0), 0);

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

  useEffect(() => {
    if (!add.open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (addRef.current && target && !addRef.current.contains(target)) {
        setAdd((current) => ({ ...current, open: false }));
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [add.open, setAdd]);

  return (
    <div className="block" style={{ width: tableWidth }}>
      <EditableTitle className="block-title" inputClassName="block-title-input" value={title} admin={admin} blockId={blockId} />
      <WarehouseRowTools items={items}/><table className="sheet-table resizable-table" style={{ width: tableWidth }}>
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
                <ColResizer
                  width={dragWidth}
                  min={24}
                  onLive={(next) => setLocalWidths((current) => ({ ...current, [`${columnGroup}:drag`]: next }))}
                  onCommit={(next) => {
                    const key = `${columnGroup}:drag`;
                    setLocalWidths((current) => ({ ...current, [key]: next }));
                    void setColumnWidthAction(key, next);
                  }}
                />
              </th>
            )}
            {columns.map((col) => (
              <th key={col}>
                {COL_LABEL[col]}
                {admin ? (
                  <ColResizer
                    width={widthOf(col)}
                    onLive={(next) => setLocalWidths((current) => ({ ...current, [`${columnGroup}:${col}`]: next }))}
                    onCommit={(next) => {
                      const key = `${columnGroup}:${col}`;
                      setLocalWidths((current) => ({ ...current, [key]: next }));
                      void setColumnWidthAction(key, next);
                    }}
                  />
                ) : null}
              </th>
            ))}
            {procurementColumns.map(([key,label])=><th key={key}>{label}</th>)}
            {(
              <th>
                {admin?<ColResizer
                  width={actionsWidth}
                  min={44}
                  onLive={(next) => setLocalWidths((current) => ({ ...current, [`${columnGroup}:actions`]: next }))}
                  onCommit={(next) => {
                    const key = `${columnGroup}:actions`;
                    setLocalWidths((current) => ({ ...current, [key]: next }));
                    void setColumnWidthAction(key, next);
                  }}
                />:null}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {personal.rows.map((item) => {
            const value = values.get(item.id) ?? 0;
            return (
              <tr
                key={item.id}
                data-item-id={item.id}
                className={`${item.needsReview ? "review-row" : ""} ${dragId === item.id ? "dragging" : ""} ${overId === item.id ? "drag-over" : ""}`}
                onDragOver={(event) => {
                  if (personal.busy) return;
                  event.preventDefault();
                  setOverId(item.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  dropOn(item.id);
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
                {columns.map((col) => (
                  <td
                    key={col}
                    className={col === "name" ? "name" : col === "size" ? "" : "num"}
                  >
                    <StockCell item={item} column={col} value={value} admin={admin} canAdjustStock={canAdjustStock} usages={usages.get(item.id) ?? []} />
                  </td>
                ))}
                <ProcurementCells id={item.id}/>
                {(
                  <td className="row-actions">
                    <button className="icon-btn" type="button" title="Скрыть строку" disabled={personal.busy} onClick={()=>personal.hide(item.id,true)}>–</button>
                    {admin?<form
                      action={(data) => {
                        if (window.confirm(`Удалить «${item.name}»?`)) return run(deleteItemAction, data);
                      }}
                    >
                      <input type="hidden" name="id" value={item.id} />
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
            {columns.map((col) => (
              <td key={col} className={`total${col === "name" || col === "size" ? (col === "name" ? " name" : "") : " num"}`}>
                {col === "name" ? "Итого" : col === "qty" ? formatQty(totalQty) : col === "sum" ? formatCost(totalSum) : ""}
              </td>
            ))}
            {procurementColumns.map(([key])=><td key={key} className="total"/>)}
            <td className="total" />
          </tr>
        </tbody>
      </table>
      {addCategory ? (
        <div className="stock-add-panel" ref={addRef}>
          <button
            type="button"
            onClick={() => setAdd((current) => ({ ...current, open: !current.open }))}
          >
            Добавить товар
          </button>
          {add.open ? (
            <AddStockForm
              category={addCategory}
              draft={add}
              onChange={setAdd}
              onAdded={() => setAdd(EMPTY_ADD_STOCK)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AddStockForm({
  category,
  draft,
  onChange,
  onAdded,
}: {
  category: ItemCategory;
  draft: AddStockDraft;
  onChange: (update: AddStockDraft | ((current: AddStockDraft) => AddStockDraft)) => void;
  onAdded: () => void;
}) {
  return (
    <form
      className="add-row stock-add-form"
      action={async (data) => {
        const result = await addItemAction(data);
        if (!result.ok) {
          window.alert(result.error);
          return;
        }
        onAdded();
      }}
    >
      {category === "strap" ? (
        <>
          <input type="hidden" name="category" value="strap" />
          <input
            name="name"
            placeholder="Новый ремешок"
            required
            value={draft.name}
            onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
          />
          <input
            name="strapSize"
            list="strap-size-options"
            type="text"
            inputMode="numeric"
            placeholder="размер, мм"
            required
            value={draft.strapSize}
            onChange={(event) => onChange((current) => ({ ...current, strapSize: event.target.value }))}
          />
          <datalist id="strap-size-options">
            <option value="38" />
            <option value="44" />
            <option value="22" />
          </datalist>
        </>
      ) : (
        <>
          <input type="hidden" name="category" value="watch" />
          <input
            name="name"
            placeholder="Новая модель"
            required
            value={draft.name}
            onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))}
          />
        </>
      )}
      <input
        name="qty"
        type="text"
        inputMode="numeric"
        placeholder="кол-во"
        value={draft.qty}
        onChange={(event) => onChange((current) => ({ ...current, qty: event.target.value }))}
      />
      <input
        name="cost"
        type="text"
        inputMode="numeric"
        placeholder="Ср. себес."
        value={draft.cost}
        onChange={(event) => onChange((current) => ({ ...current, cost: event.target.value }))}
      />
      <button type="submit" className="primary">
        Добавить
      </button>
    </form>
  );
}

function StockCell({
  item,
  column,
  value,
  admin,
  canAdjustStock,
  usages,
}: {
  item: Item;
  column: StockColumnId;
  value: number;
  admin: boolean;
  canAdjustStock: boolean;
  usages: ItemUsage[];
}) {
  if (column === "sum") return <>{formatCost(value)}</>;
  if (column === "size") return <>{item.strapSize ? `${item.strapSize} mm` : ""}</>;
  if (column === "name") {
    return (
      <ItemUsagePreview itemId={item.id} name={item.name} usages={usages} editable={admin}>
        {admin ? <StockInlineField id={item.id} name="name" value={item.name} /> : item.name}
      </ItemUsagePreview>
    );
  }
  if (column === "qty") {
    return admin || canAdjustStock ? <StockInlineField id={item.id} name="onHand" value={String(item.onHand)} number /> : <>{formatQty(item.onHand)}</>;
  }
  if (column === "cost") {
    return admin ? (
      <StockInlineField id={item.id} name="cost" value={item.cost == null ? "" : formatCost(item.cost)} number />
    ) : (
      <>{item.cost == null ? "" : formatCost(item.cost)}</>
    );
  }
  return null;
}

function ColResizer({
  width,
  min = 40,
  onLive,
  onCommit,
}: {
  width: number;
  min?: number;
  onLive: (width: number) => void;
  onCommit: (width: number) => void;
}) {
  const start = useRef({ x: 0, w: 0 });

  return (
    <span
      className="col-resizer"
      title="Потяните, чтобы изменить ширину"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        start.current = { x: event.clientX, w: width };
        function move(ev: MouseEvent) {
          const next = Math.max(min, start.current.w + ev.clientX - start.current.x);
          onLive(next);
        }
        function up(ev: MouseEvent) {
          const next = Math.max(min, start.current.w + ev.clientX - start.current.x);
          onCommit(next);
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        }
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    />
  );
}

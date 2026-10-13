"use client";

import { receiveAction } from "@/app/actions";
import { SkuPicker } from "@/components/SkuPicker";
import { averageCostAfterReceipt } from "@/lib/cost";
import { formatCost, formatQty, itemTitle } from "@/lib/format";
import type { AppState, Item } from "@/lib/types";
import { useSessionDraft } from "@/lib/ui-session";
import { useMemo, useState } from "react";

type Line = { key: string; itemId: string; qty: string; cost: string };

function emptyLine(key: string): Line {
  return { key, itemId: "", qty: "", cost: "" };
}

const EMPTY_RECEIPT_LINES: Line[] = [emptyLine("new-0")];

function nextEmptyLine(current: Line[]): Line {
  const n = current.reduce((max, line) => {
    const match = /^new-(\d+)$/.exec(line.key);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return emptyLine(`new-${n + 1}`);
}

function withTrailingEmpty(lines: Line[]): Line[] {
  if (!Array.isArray(lines) || lines.length === 0) return EMPTY_RECEIPT_LINES;
  const last = lines[lines.length - 1];
  if (last?.itemId) return [...lines, nextEmptyLine(lines)];
  return lines;
}

function parsePurchase(raw: string) {
  if (raw.trim() === "") return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function ReceiptForm({ state }: { state: AppState }) {
  const [message, setMessage] = useState("");
  const [storedLines, setLines] = useSessionDraft<Line[]>("receipt.lines", EMPTY_RECEIPT_LINES);
  const lines = withTrailingEmpty(storedLines);
  const items = useMemo(
    () =>
      [...state.items]
        .filter((item) => item.stockKind === "main")
        .sort((a, b) => itemTitle(a).localeCompare(itemTitle(b), "ru")),
    [state.items],
  );
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  function patchLine(index: number, next: Partial<Line>) {
    setLines((current) => {
      const base = withTrailingEmpty(current);
      const updated = base.map((row, i) => (i === index ? { ...row, ...next } : row));
      const last = updated[updated.length - 1];
      if (last?.itemId) return [...updated, nextEmptyLine(updated)];
      let end = updated.length - 1;
      while (end > 0 && !updated[end].itemId && !updated[end - 1].itemId) end -= 1;
      return updated.slice(0, end + 1);
    });
  }

  const running = useMemo(() => {
    const stock = new Map<string, { qty: number; cost: number | null }>();
    for (const item of items) stock.set(item.id, { qty: item.onHand, cost: item.cost });
    return lines.map((line) => {
      const current = stock.get(line.itemId) ?? { qty: 0, cost: null };
      const qty = Number(line.qty) || 0;
      const purchase = parsePurchase(line.cost);
      if (!line.itemId || qty <= 0 || purchase == null) {
        return { purchase, sum: 0, afterQty: current.qty, afterCost: current.cost, ready: false };
      }
      const afterCost = averageCostAfterReceipt(current.qty, current.cost, qty, purchase);
      const afterQty = Math.max(0, current.qty) + qty;
      stock.set(line.itemId, { qty: afterQty, cost: afterCost });
      return { purchase, sum: qty * purchase, afterQty, afterCost, ready: true };
    });
  }, [items, lines]);

  const filled = lines.filter((line) => line.itemId);
  const totalQty = filled.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
  const totalSum = running.reduce((sum, row) => sum + row.sum, 0);

  return (
    <form
      className="receipt-form"
      action={async (data) => {
        const result = await receiveAction(data);
        if (!result.ok) {
          setMessage(result.error);
          return;
        }
        setMessage("Оприходовано. Остатки и средняя себестоимость обновлены.");
        setLines(EMPTY_RECEIPT_LINES);
      }}
    >
      <table className="sheet-table mobile-cards" style={{ width: "100%" }}>
        <thead>
          <tr className="headers">
            <th>Название</th>
            <th>Кол-во</th>
            <th>Цена закупки</th>
            <th>Сумма</th>
            <th>Средняя себес. на складе</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const item = itemsById.get(line.itemId);
            const preview = running[index];
            const lastEmpty = index === lines.length - 1 && !line.itemId;
            return (
              <tr key={line.key}>
                <td data-label="Товар" className="name picker-cell">
                  <SkuPicker
                    items={items}
                    name="itemId"
                    queryName={null}
                    value={line.itemId}
                    required={!lastEmpty || undefined}
                    sortByTitle
                    placeholder="Найти товар"
                    label={itemLabel}
                    onChange={(item) => {
                      patchLine(index, { itemId: item?.id ?? "", cost: "" });
                    }}
                  />
                </td>
                <td data-label="Кол-во" className="num">
                  <input
                    className="cell-input num"
                    name="qty"
                    type="text"
                    inputMode="numeric"
                    required={!lastEmpty || undefined}
                    placeholder="кол-во"
                    value={line.qty}
                    onChange={(event) => patchLine(index, { qty: event.target.value })}
                  />
                </td>
                <td data-label="Цена закупки" className="num">
                  <input
                    className="cell-input num"
                    name="cost"
                    type="text"
                    inputMode="decimal"
                    placeholder="закупка"
                    required={!lastEmpty || undefined}
                    value={line.cost}
                    onChange={(event) => patchLine(index, { cost: event.target.value })}
                  />
                </td>
                <td data-label="Сумма" className="num">{line.itemId && preview.purchase != null ? formatCost(preview.sum) : ""}</td>
                <td data-label="Средняя себес. на складе" className="num">
                  {item && preview.ready && preview.afterCost != null ? (
                    <>
                      станет {formatQty(preview.afterQty)} шт × {formatCost(preview.afterCost)} ₽
                    </>
                  ) : item ? (
                    <>
                      сейчас {formatQty(preview.afterQty)} шт ×{" "}
                      {preview.afterCost == null ? "—" : `${formatCost(preview.afterCost)} ₽`}
                    </>
                  ) : (
                    ""
                  )}
                </td>
                <td data-label="">
                  {lines.length > 1 && line.itemId ? (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() =>
                        setLines((current) => {
                          const next = withTrailingEmpty(current).filter((_, i) => i !== index);
                          const last = next[next.length - 1];
                          if (!last || last.itemId) return [...next, nextEmptyLine(next)];
                          return next.length ? next : EMPTY_RECEIPT_LINES;
                        })
                      }
                    >
                      ×
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
          <tr>
            <td data-label="Товар" className="total name">Итого</td>
            <td data-label="Кол-во" className="total num">{formatQty(totalQty)}</td>
            <td data-label="Цена закупки" className="total" />
            <td data-label="Сумма" className="total num">{formatCost(totalSum)}</td>
            <td data-label="Средняя себес. на складе" className="total" />
            <td data-label="" className="total" />
          </tr>
        </tbody>
      </table>
      <div className="toolbar-row">
        <button type="submit" className="primary">
          Оприходовать всё сразу
        </button>
      </div>
      {message ? <p>{message}</p> : null}
    </form>
  );
}

function itemLabel(item: Item) {
  const cost = item.cost == null ? "без себес." : `${formatCost(item.cost)} ₽`;
  return `${itemTitle(item)} · на складе ${formatQty(item.onHand)} шт, ${cost}`;
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { updateKitAction } from "@/app/actions";
import { SkuPicker } from "@/components/SkuPicker";
import { PageHint } from "@/components/PageHint";
import { lastBuyPrice, parseMoney } from "@/lib/cost";
import { formatCost, itemTitle } from "@/lib/format";
import type { Item, Kit } from "@/lib/types";
import { useClearSessionDraft, useSessionDraft } from "@/lib/ui-session";

type DraftLine = { componentItemId: string; qty: number; cost: string };
type KitDraft = { newSku: string; lines: DraftLine[] };

function emptyKitLine(): DraftLine {
  return { componentItemId: "", qty: 1, cost: "" };
}

function costDraftOf(item: Item | undefined) {
  if (!item) return "";
  const cost = item.lastPurchaseCost ?? item.cost;
  return cost == null ? "" : formatCost(cost);
}

function linesFromKit(kit: Kit, components: Item[]): DraftLine[] {
  const filled = kit.lines.map((line) => ({
    componentItemId: line.componentItemId,
    qty: line.qty,
    cost: costDraftOf(components.find((item) => item.id === line.componentItemId)),
  }));
  return filled.length ? [...filled, emptyKitLine()] : [emptyKitLine()];
}

function withTrailingEmpty(lines: DraftLine[]): DraftLine[] {
  if (!Array.isArray(lines) || lines.length === 0) return [emptyKitLine()];
  const last = lines[lines.length - 1];
  if (last?.componentItemId) return [...lines, emptyKitLine()];
  return lines;
}

export function KitEditor({ kit, components }: { kit: Kit; components: Item[] }) {
  const router = useRouter();
  const options = useMemo(
    () => components.filter((item) => item.stockKind === "main").sort((a, b) => itemTitle(a).localeCompare(itemTitle(b), "ru")),
    [components],
  );
  const itemsById = useMemo(() => new Map(options.map((item) => [item.id, item])), [options]);
  const fallback = useMemo<KitDraft>(
    () => ({ newSku: kit.sku, lines: linesFromKit(kit, components) }),
    [kit, components],
  );
  const clearSessionDraft=useClearSessionDraft();
  const [draft, setDraft] = useSessionDraft<KitDraft>(`kit.${kit.sku}`, fallback);
  const lines = withTrailingEmpty(draft.lines);
  const [error, setError] = useState("");
  const filled = lines.filter((line) => line.componentItemId);
  const nextStatus = filled.length > 0 ? "ok" : "needs_setup";
  const kitBuyCost = filled.reduce((sum, line) => {
    const item = itemsById.get(line.componentItemId);
    if (!item) return sum;
    const raw = line.cost.trim() === "" ? lastBuyPrice(item) : parseMoney(line.cost);
    return sum + line.qty * (raw ?? 0);
  }, 0);

  return (
    <form
      action={async (data) => {
        const result = await updateKitAction(data);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        clearSessionDraft(`kit.${kit.sku}`);
        router.push("/kits");
        router.refresh();
      }}
    >
      <input type="hidden" name="sku" value={kit.sku} />
      <label style={{ display: "grid", gap: 4, marginBottom: 12, maxWidth: 420 }}>
        Название артикула
        <input
          name="newSku"
          value={draft.newSku ?? kit.sku}
          onChange={(event) => setDraft((current) => ({ ...current, newSku: event.target.value }))}
        />
      </label>
      <p>
        Статус после сохранения:{" "}
        <strong>{nextStatus === "ok" ? "Состав определён" : "Требует настройки"}</strong>
      </p>
      <PageHint>
        <p className="hint">
          Себес. закупки — последняя цена оприходования этой комплектующей. После прихода она обновится сама. Сводка
          поставок считает докупку по этой цене, а не по средней на складе.
        </p>
      </PageHint>
      <table className="sheet-table mobile-cards mobile-kit-editor" style={{ width: "100%", marginBottom: 12 }}>
        <thead>
          <tr className="headers">
            <th>Комплектующая</th>
            <th>Кол-во на 1 шт.</th>
            <th>Себес. закупки</th>
            <th>Сумма</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const purchase = parseMoney(line.cost);
            const lineSum = line.componentItemId && purchase != null ? line.qty * purchase : 0;
            const lastEmpty = index === lines.length - 1 && !line.componentItemId;
            return (
              <tr key={`${line.componentItemId}-${index}`}>
                <td data-label="Комплектующая" className="picker-cell">
                  <SkuPicker
                    items={options}
                    name="componentId"
                    queryName={null}
                    value={line.componentItemId}
                    required={!lastEmpty || undefined}
                    sortByTitle
                    placeholder="Найти комплектующую"
                    label={(item) =>
                      `${itemTitle(item)}${
                        item.lastPurchaseCost != null || item.cost != null ? ` · закуп. ${formatCost(lastBuyPrice(item))} ₽` : ""
                      }`
                    }
                    onChange={(item) => {
                      const nextId = item?.id ?? "";
                      const nextItem = itemsById.get(nextId);
                      setDraft((current) => {
                        const updated = withTrailingEmpty(current.lines).map((row, i) =>
                          i === index ? { ...row, componentItemId: nextId, cost: costDraftOf(nextItem) } : row,
                        );
                        const last = updated[updated.length - 1];
                        const lines = last?.componentItemId ? [...updated, emptyKitLine()] : updated;
                        return { ...current, lines };
                      });
                    }}
                  />
                </td>
                <td data-label="Кол-во на 1 шт.">
                  <input
                    name="qty"
                    type="text"
                    inputMode="numeric"
                    value={line.qty}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        lines: withTrailingEmpty(current.lines).map((row, i) =>
                          i === index ? { ...row, qty: Number(event.target.value) || 1 } : row,
                        ),
                      }))
                    }
                    style={{ width: "100%", border: 0, textAlign: "right" }}
                  />
                </td>
                <td data-label="Себес. закупки">
                  <input
                    name="cost"
                    type="text"
                    inputMode="decimal"
                    placeholder="закупка"
                    value={line.cost}
                    required={!lastEmpty || undefined}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        lines: withTrailingEmpty(current.lines).map((row, i) => (i === index ? { ...row, cost: event.target.value } : row)),
                      }))
                    }
                    style={{ width: "100%", border: 0, textAlign: "right" }}
                  />
                </td>
                <td data-label="Сумма" className="num">{line.componentItemId && purchase != null ? formatCost(lineSum) : ""}</td>
                <td data-label="">
                  {line.componentItemId ? (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => {
                          const next = withTrailingEmpty(current.lines).filter((_, i) => i !== index);
                          const last = next[next.length - 1];
                          const lines =
                            !last || last.componentItemId
                              ? [...next, emptyKitLine()]
                              : next.length
                                ? next
                                : [emptyKitLine()];
                          return { ...current, lines };
                        })
                      }
                    >
                      Убрать
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
          <tr>
            <td data-label="Комплектующая" className="total name">Закупочная себес. 1 шт</td>
            <td data-label="Кол-во на 1 шт." className="total" />
            <td data-label="Себес. закупки" className="total" />
            <td data-label="Сумма" className="total num">{formatCost(kitBuyCost)}</td>
            <td data-label="" className="total" />
          </tr>
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="primary">
          Сохранить
        </button>
      </div>
      {error ? <p className="warn-text">{error}</p> : null}
    </form>
  );
}

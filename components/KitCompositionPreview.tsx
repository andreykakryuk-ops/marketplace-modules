"use client";

import type { ReactNode } from "react";
import { HoverPreview } from "@/components/HoverPreview";
import { formatQty, itemTitle } from "@/lib/format";
import type { AppState } from "@/lib/types";

export function KitCompositionPreview({
  state, itemId, shipmentQty, shipmentName, children,
}: {
  state: AppState; itemId: string; shipmentQty?: number; shipmentName?: string; children: ReactNode;
}) {
  const item = state.items.find(entry => entry.id === itemId);
  const kit = state.kits.find(entry => entry.finishedItemId === itemId);
  const totals = new Map<string, number>();
  for (const line of kit?.lines ?? []) {
    totals.set(line.componentItemId, (totals.get(line.componentItemId) ?? 0) + line.qty);
  }
  return (
    <div data-kit-preview={itemId}>
      <HoverPreview label="Состав артикула" content={
        <>
          {shipmentName ? <p>{shipmentName}</p> : null}
          <strong>{item ? itemTitle(item) : itemId}</strong>
          {item && item.stockKind !== "finished" ? (
            <p>Отдельная позиция. При проведении спишется со склада как есть, без сборки комплекта.</p>
          ) : !totals.size ? (
            <p className="warn-text">Состав комплекта не настроен.</p>
          ) : (
            <table className="kit-preview-table">
              <thead><tr><th>Комплектующая</th><th>На 1 шт.</th>{shipmentQty !== undefined ? <th>На поставку</th> : null}</tr></thead>
              <tbody>
                {[...totals].map(([componentId, qty]) => {
                  const component = state.items.find(entry => entry.id === componentId);
                  return (
                    <tr key={componentId}>
                      <td>{component ? itemTitle(component) : componentId}</td>
                      <td className="num">{formatQty(qty)}</td>
                      {shipmentQty !== undefined ? <td className="num">{formatQty(qty * shipmentQty)}</td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      }>
        {children}
      </HoverPreview>
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import { HoverPreview } from "@/components/HoverPreview";
import { formatQty } from "@/lib/format";
import type { ItemUsage } from "@/lib/item-usage";

export function ItemUsagePreview({
  itemId, name, usages, editable, children,
}: {
  itemId: string; name: string; usages: ItemUsage[]; editable: boolean; children: ReactNode;
}) {
  return (
    <div data-item-usage={itemId}>
      <HoverPreview label="Входит в артикулы" editable={editable} content={
        <>
          <strong>{name}</strong>
          <p>Входит в артикулы</p>
          {usages.length ? (
            <ul>
              {usages.map(usage => (
                <li key={usage.sku}><span>{usage.sku}</span><small>{formatQty(usage.qty)} шт. на комплект</small></li>
              ))}
            </ul>
          ) : <p className="item-usage-empty">Пока не входит ни в один артикул.</p>}
        </>
      }>
        {children}
      </HoverPreview>
    </div>
  );
}

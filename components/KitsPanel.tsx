"use client";

import Link from "next/link";
import { addKitAction, deleteKitAction, updateKitAction } from "@/app/actions";
import { kitAverageCost } from "@/lib/bom";
import { formatCost, itemTitle } from "@/lib/format";
import type { AppState, Kit } from "@/lib/types";
import { useSessionDraft } from "@/lib/ui-session";

async function run(action: (data: FormData) => Promise<{ ok: true } | { ok: false; error: string }>, data: FormData) {
  const result = await action(data);
  if (!result.ok) window.alert(result.error);
  return result;
}

export function KitsPanel({ state }: { state: AppState }) {
  const [newSku, setNewSku] = useSessionDraft("kits.newSku", "");

  return (
    <div className="page-flow" style={{ padding: 16 }}>

      <table className="sheet-table mobile-cards mobile-kits-list" style={{ width: "100%", maxWidth: 1200 }}>
        <thead>
          <tr className="headers">
            <th>Артикул</th>
            <th>Статус</th>
            <th>Комплектующие</th>
            <th>Средневзв. себес.</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {state.kits.map((kit) => (
            <tr key={kit.sku}>
              <td data-label="Артикул" className={`name${kit.status === "needs_setup" ? " warn" : ""}`}>
                <KitNameField kit={kit} />
              </td>
              <td data-label="Статус" className={kit.status === "needs_setup" ? "warn" : ""}>
                {kit.status === "needs_setup" ? "Требует настройки" : "Состав определён"}
              </td>
              <td data-label="Комплектующие" className="name" style={{ whiteSpace: "normal" }}>
                <span className="kit-content-desktop">{kitContents(state, kit)}</span><details className="kit-content-disclosure"><summary>Комплектующие</summary>{kitContents(state, kit)}</details>
              </td>
              <td data-label="Средневзв. себес." className="num">{kitAverageLabel(state, kit)}</td>
              <td data-label="Действия">
                <div className="qty-form">
                  <Link href={`/kits/${encodeURIComponent(kit.sku)}`} className="sheet-link-btn">
                    Состав
                  </Link>
                  <form
                    action={async (data) => {
                      if (
                        !window.confirm(
                          `Точно хотите удалить артикул «${kit.sku}»? Он полностью удалится из комплектов и склада.`,
                        )
                      ) {
                        return;
                      }
                      await run(deleteKitAction, data);
                    }}
                  >
                    <input type="hidden" name="sku" value={kit.sku} />
                    <button type="submit">Удалить</button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="add-row"
        action={async (data) => {
          const result = await addKitAction(data);
          if (!result.ok) {
            window.alert(result.error);
            return;
          }
          setNewSku("");
        }}
      >
        <input
          name="newSku"
          placeholder="Название нового артикула"
          required
          value={newSku}
          onChange={(event) => setNewSku(event.target.value)}
        />
        <button type="submit" className="primary">
          Добавить артикул
        </button>
      </form>
    </div>
  );
}

function kitContents(state: AppState, kit: Kit) {
  const parts = kit.lines
    .map((line) => {
      const item = state.items.find((entry) => entry.id === line.componentItemId);
      if (!item) return "";
      const title = itemTitle(item);
      return line.qty > 1 ? `${title} × ${line.qty}` : title;
    })
    .filter(Boolean);
  return parts.length ? parts.join(" + ") : "—";
}

function kitAverageLabel(state: AppState, kit: Kit) {
  const cost = kitAverageCost(state, kit);
  return cost == null ? "—" : formatCost(cost);
}

function KitNameField({ kit }: { kit: Kit }) {
  const [draft, setDraft] = useSessionDraft<{ source: string; text: string } | null>(`kits.name.${kit.sku}`, null);
  const name = draft?.source === kit.sku ? draft.text : kit.sku;

  return (
    <form
      action={async (data) => {
        const result = await run(updateKitAction, data);
        if (result.ok) setDraft(null);
      }}
      onBlur={(event) => {
        if (name.trim() === kit.sku) return;
        event.currentTarget.requestSubmit();
      }}
    >
      <input type="hidden" name="sku" value={kit.sku} />
      {kit.lines.map((line) => (
        <span key={line.componentItemId}>
          <input type="hidden" name="componentId" value={line.componentItemId} />
          <input type="hidden" name="qty" value={String(line.qty)} />
        </span>
      ))}
      <input
        className="cell-input"
        name="newSku"
        value={name}
        onChange={(event) => setDraft({ source: kit.sku, text: event.target.value })}
      />
    </form>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateItemAction } from "@/app/actions";
import { useClearSessionDraft, useSessionDraft } from "@/lib/ui-session";

type Draft = { version: 2; source: string; text: string };

export function StockInlineField({
  id, name, value, number = false,
}: {
  id: string;
  name: "name" | "onHand" | "cost";
  value: string;
  number?: boolean;
}) {
  const key = `stock.cell.${id}.${name}`;
  const clearSessionDraft=useClearSessionDraft();
  const [draft, setDraft] = useSessionDraft<Draft | null>(key, null);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const router = useRouter();
  // Old drafts may describe an already-saved change. Never revive them when
  // a receipt/undo makes the server value equal to their former source again.
  const valid = draft?.version === 2 && draft.source === value;
  const text = valid ? draft.text : value;

  useEffect(() => {
    if (draft && !valid) clearSessionDraft(key);
  }, [draft, key, valid, clearSessionDraft]);

  return (
    <form
      action={async (data) => {
        if (saving.current || text === value) return;
        saving.current = true;
        setPending(true);
        if (name === "onHand") data.set("expectedOnHand", value);
        try {
          const result = await updateItemAction(data);
          if (!result.ok) {
            window.alert(result.error);
            router.refresh();
            return;
          }
          clearSessionDraft(key);
        } catch {
          window.dispatchEvent(new Event("warehouse-save-error"));
          window.alert("Не удалось подтвердить сохранение. Обновите страницу и проверьте остаток перед повтором. Ваш ввод сохранён в черновике.");
        } finally {
          saving.current = false;
          setPending(false);
        }
      }}
      onBlur={(event) => {
        if (saving.current || text === value) return;
        event.currentTarget.requestSubmit();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input
        className={`cell-input${number ? " num" : ""}`}
        name={name}
        value={text}
        type="text"
        inputMode={number ? "numeric" : "text"}
        readOnly={pending}
        aria-busy={pending}
        onChange={(event) => setDraft({ version: 2, source: value, text: event.target.value })}
      />
    </form>
  );
}

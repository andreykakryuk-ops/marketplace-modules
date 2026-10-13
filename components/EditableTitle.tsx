"use client";

import { setBlockTitleAction, setProjectNameAction } from "@/app/actions";
import type { BlockId } from "@/lib/types";
import { useSessionDraft } from "@/lib/ui-session";

async function save(action: (data: FormData) => Promise<{ ok: true } | { ok: false; error: string }>, data: FormData) {
  const result = await action(data);
  if (!result.ok) window.alert(result.error);
}

export function EditableTitle({
  value,
  admin,
  className,
  inputClassName,
  blockId,
}: {
  value: string;
  admin: boolean;
  className?: string;
  inputClassName?: string;
  blockId?: BlockId;
}) {
  const [draft, setDraft] = useSessionDraft<{ source: string; text: string } | null>(
    `title.${blockId ?? "project"}`,
    null,
  );
  const text = draft?.source === value ? draft.text : value;

  if (!admin) return <div className={className}>{value}</div>;

  return (
    <form
      className={className}
      action={async (data) => {
        await save(blockId ? setBlockTitleAction : setProjectNameAction, data);
      }}
      onBlur={(event) => {
        if (text.trim() === value || !text.trim()) {
          setDraft(null);
          return;
        }
        event.currentTarget.requestSubmit();
      }}
    >
      {blockId ? <input type="hidden" name="blockId" value={blockId} /> : null}
      <input
        className={inputClassName}
        name={blockId ? "title" : "projectName"}
        value={text}
        onChange={(event) => setDraft({ source: value, text: event.target.value })}
        aria-label={blockId ? "Название блока" : "Название проекта"}
      />
    </form>
  );
}

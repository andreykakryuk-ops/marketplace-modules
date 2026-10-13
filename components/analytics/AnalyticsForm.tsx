"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
type ActionResult = {ok:boolean;error?:string};

const INITIAL: ActionResult = { ok: false };

export function AnalyticsForm({ action, children, confirmation }: {
  action: (form: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  confirmation?: string;
}) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(async (_previous: ActionResult, form: FormData) => {
    const result = await action(form);
    if (result.ok) router.refresh();
    return result;
  }, INITIAL);
  return <form action={dispatch} onSubmit={event => { if (confirmation && !window.confirm(confirmation)) event.preventDefault(); }}>
    <fieldset disabled={pending}>{children}</fieldset>
    {pending ? <p role="status">Сохраняем…</p> : state.error ? <p role="alert" className="an-error">{state.error}</p> : state.ok ? <p role="status">Сохранено</p> : null}
  </form>;
}

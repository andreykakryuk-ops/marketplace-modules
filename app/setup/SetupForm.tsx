"use client";

import { useActionState } from "react";
import { setupAdminAction, type SetupFormState } from "@/app/setup/actions";

const INITIAL_STATE: SetupFormState = { error: "" };

export function SetupForm() {
  const [state, formAction, pending] = useActionState(setupAdminAction, INITIAL_STATE);

  return (
    <form className="auth-form" action={formAction}>
      <label>
        Ключ первичной настройки
        <input name="setupKey" type="password" autoComplete="off" required autoFocus />
      </label>
      <label>
        Почта администратора
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Пароль
        <input name="password" type="password" minLength={10} autoComplete="new-password" required />
      </label>
      <label>
        Повторите пароль
        <input name="passwordRepeat" type="password" minLength={10} autoComplete="new-password" required />
      </label>
      <p className="hint">Минимум 10 символов. На сервере сохраняется только защищённый хеш пароля.</p>
      {state.error ? <p className="auth-error">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Настройка…" : "Создать вход администратора"}
      </button>
    </form>
  );
}

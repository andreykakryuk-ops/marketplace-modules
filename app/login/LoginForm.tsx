"use client";

import { useActionState } from "react";
import { loginAction, type LoginFormState } from "@/app/login/actions";

const INITIAL_STATE: LoginFormState = { error: "" };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL_STATE);

  return (
    <form className="auth-form" action={formAction}>
      <label>
        Почта
        <input name="email" type="email" autoComplete="username" required autoFocus />
      </label>
      <label>
        Пароль
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error ? <p className="auth-error">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Вход…" : "Войти"}
      </button>
    </form>
  );
}

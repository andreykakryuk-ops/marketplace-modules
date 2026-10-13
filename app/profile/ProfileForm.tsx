"use client";

import { useActionState } from "react";
import {
  changePasswordAction,
  type ChangePasswordFormState,
} from "@/app/profile/actions";

const INITIAL_STATE: ChangePasswordFormState = { error: "" };

export function ProfileForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, INITIAL_STATE);

  return (
    <form className="auth-form" action={formAction}>
      <label>
        Текущий пароль
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          maxLength={256}
          required
          autoFocus
        />
      </label>
      <label>
        Новый пароль
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={256}
          required
        />
      </label>
      <label>
        Повторите новый пароль
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={256}
          required
        />
      </label>
      {state.error ? <p className="auth-error">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Сохраняем…" : "Изменить пароль"}
      </button>
    </form>
  );
}

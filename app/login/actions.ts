"use server";

import { redirect } from "next/navigation";
import { authenticate, getLoginAccount, isAuthRequired } from "@/lib/auth";
import { createSession } from "@/lib/session";

export type LoginFormState = {
  error: string;
};

const attempts = new Map<string, { count: number; blockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const BLOCK_TIME_MS = 15 * 60 * 1000;

function attemptKey(email: string) {
  return email.trim().toLowerCase();
}

function isBlocked(key: string) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (entry.blockedUntil > Date.now()) return true;
  if (entry.blockedUntil > 0) attempts.delete(key);
  return false;
}

function registerFailure(key: string) {
  const entry = attempts.get(key) ?? { count: 0, blockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) entry.blockedUntil = Date.now() + BLOCK_TIME_MS;
  attempts.set(key, entry);
}

export async function loginAction(
  _previousState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  if (!isAuthRequired()) redirect("/");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const key = attemptKey(email);

  if (isBlocked(key)) {
    return { error: "Слишком много попыток. Повторите вход через 15 минут." };
  }

  const user = authenticate(email, password);
  if (!user) {
    registerFailure(key);
    return { error: "Неверная почта или пароль" };
  }

  attempts.delete(key);
  await createSession(user.id);
  redirect(getLoginAccount(user.id)?.mustChangePassword ? "/profile?required=1" : "/");
}

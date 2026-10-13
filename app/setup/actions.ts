"use server";

import { redirect } from "next/navigation";
import { hasLoginAccounts, isAuthRequired, setupAdminAccount } from "@/lib/auth";
import { createSession } from "@/lib/session";

export type SetupFormState = {
  error: string;
};

export async function setupAdminAction(
  _previousState: SetupFormState,
  formData: FormData,
): Promise<SetupFormState> {
  if (!isAuthRequired()) redirect("/");
  if (hasLoginAccounts()) redirect("/login");

  const password = String(formData.get("password") ?? "");
  const passwordRepeat = String(formData.get("passwordRepeat") ?? "");
  if (password !== passwordRepeat) return { error: "Пароли не совпадают" };

  try {
    const admin = setupAdminAccount(
      String(formData.get("email") ?? ""),
      password,
      String(formData.get("setupKey") ?? ""),
    );
    await createSession(admin.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не удалось настроить администратора" };
  }
  redirect("/");
}

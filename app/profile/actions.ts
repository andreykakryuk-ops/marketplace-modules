"use server";

import { redirect } from "next/navigation";
import { changeOwnPassword, getLoginAccount } from "@/lib/auth";
import { createSession, getSessionUser } from "@/lib/session";

export type ChangePasswordFormState = {
  error: string;
};

export async function changePasswordAction(
  _previousState: ChangePasswordFormState,
  formData: FormData,
): Promise<ChangePasswordFormState> {
  const user = await getSessionUser({ allowPasswordChange: true });
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword !== confirmPassword) {
    return { error: "Новые пароли не совпадают" };
  }

  const wasRequired = getLoginAccount(user.id)?.mustChangePassword ?? false;
  try {
    changeOwnPassword(user.id, currentPassword, newPassword);
    await createSession(user.id);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Не удалось изменить пароль",
    };
  }

  redirect(wasRequired ? "/" : "/profile?changed=1");
}

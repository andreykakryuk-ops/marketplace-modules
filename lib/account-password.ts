import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  validatePassword,
  verifyPassword,
} from "@/lib/password";

export type PasswordAccount = {
  passwordHash: string;
  sessionVersion: number;
  mustChangePassword: boolean;
};

export function replaceAccountPassword<T extends PasswordAccount>(
  account: T,
  newPassword: string,
  mustChangePassword: boolean,
): T {
  validatePassword(newPassword);
  return {
    ...account,
    passwordHash: hashPassword(newPassword),
    sessionVersion: Math.max(1, Math.trunc(account.sessionVersion) || 1) + 1,
    mustChangePassword,
  };
}

export function changeOwnAccountPassword<T extends PasswordAccount>(
  account: T,
  currentPassword: string,
  newPassword: string,
): T {
  if (
    !currentPassword ||
    currentPassword.length > PASSWORD_MAX_LENGTH ||
    !verifyPassword(currentPassword, account.passwordHash)
  ) {
    throw new Error("Текущий пароль указан неверно");
  }
  validatePassword(newPassword);
  if (verifyPassword(newPassword, account.passwordHash)) {
    throw new Error("Новый пароль должен отличаться от текущего");
  }
  return replaceAccountPassword(account, newPassword, false);
}

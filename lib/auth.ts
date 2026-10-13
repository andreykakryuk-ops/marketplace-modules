import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AppUser } from "@/lib/types";
import { addEmployee, readState, requireAdmin } from "@/lib/store";
import { writeJsonFileAtomic } from "@/lib/atomic-file";
import {
  changeOwnAccountPassword,
  replaceAccountPassword,
} from "@/lib/account-password";
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  validatePassword,
  verifyPassword,
} from "@/lib/password";

const AUTH_PATH = path.join(process.cwd(), "data", "auth.json");
const EMAIL_MAX_LENGTH = 254;

type AuthAccount = {
  userId: string;
  email: string;
  passwordHash: string;
  sessionVersion: number;
  mustChangePassword: boolean;
};

type AuthFile = {
  accounts: AuthAccount[];
};

export type LoginAccountSummary = {
  userId: string;
  email: string;
  configured: boolean;
  mustChangePassword: boolean;
};

function emptyAuthFile(): AuthFile {
  return { accounts: [] };
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function validateEmail(value: string) {
  const email = normalizeEmail(value);
  if (email.length > EMAIL_MAX_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Укажите корректную почту");
  }
  return email;
}

function normalizeAccount(value: Partial<AuthAccount>): AuthAccount | null {
  const userId = String(value.userId ?? "").trim();
  const email = normalizeEmail(String(value.email ?? ""));
  const passwordHash = String(value.passwordHash ?? "");
  if (!userId || !email || !passwordHash) return null;
  return {
    userId,
    email,
    passwordHash,
    sessionVersion: Math.max(1, Math.trunc(Number(value.sessionVersion) || 1)),
    mustChangePassword: value.mustChangePassword === true,
  };
}

function readAuthFile(): AuthFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8")) as Partial<AuthFile>;
    const accounts = (parsed.accounts ?? [])
      .map((account) => normalizeAccount(account))
      .filter((account): account is AuthAccount => account !== null);
    return { accounts };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyAuthFile();
    throw new Error("Файл учётных записей повреждён или недоступен", { cause: error });
  }
}

function writeAuthFile(file: AuthFile) {
  writeJsonFileAtomic(AUTH_PATH, file, 0o600);
}

function assertEmailAvailable(file: AuthFile, email: string, exceptUserId?: string) {
  if (file.accounts.some((account) => account.email === email && account.userId !== exceptUserId)) {
    throw new Error("Эта почта уже используется");
  }
}

function setupKeyMatches(received: string) {
  const expected = process.env.SETUP_KEY ?? "";
  if (!expected) return process.env.NODE_ENV !== "production";
  const actualBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isAuthRequired() {
  return process.env.AUTH_REQUIRED !== "0" || readAuthFile().accounts.length > 0;
}

export function hasLoginAccounts() {
  return readAuthFile().accounts.length > 0;
}

export function listLoginAccounts(): LoginAccountSummary[] {
  return readAuthFile().accounts.map((account) => ({
    userId: account.userId,
    email: account.email,
    configured: true,
    mustChangePassword: account.mustChangePassword,
  }));
}

export function getLoginAccount(userId: string) {
  const account = readAuthFile().accounts.find((entry) => entry.userId === userId);
  if (!account) return null;
  return {
    userId: account.userId,
    email: account.email,
    sessionVersion: account.sessionVersion,
    mustChangePassword: account.mustChangePassword,
  };
}

export function authenticate(emailRaw: string, password: string): AppUser | null {
  const email = normalizeEmail(emailRaw);
  if (email.length > EMAIL_MAX_LENGTH || password.length > PASSWORD_MAX_LENGTH) return null;
  const account = readAuthFile().accounts.find((entry) => entry.email === email);
  if (!account || !verifyPassword(password, account.passwordHash)) return null;
  return readState().users.find((user) => user.id === account.userId) ?? null;
}

export function setupAdminAccount(emailRaw: string, password: string, setupKey: string) {
  const file = readAuthFile();
  if (file.accounts.length > 0) throw new Error("Администратор уже настроен");
  if (!setupKeyMatches(setupKey)) throw new Error("Неверный ключ первичной настройки");

  const admin = readState().users.find((user) => user.role === "admin");
  if (!admin) throw new Error("Администратор не найден");
  const email = validateEmail(emailRaw);
  validatePassword(password);
  file.accounts.push({
    userId: admin.id,
    email,
    passwordHash: hashPassword(password),
    sessionVersion: 1,
    mustChangePassword: false,
  });
  writeAuthFile(file);
  return admin;
}

export function createEmployeeWithLogin(name: string, emailRaw: string, password: string, actor: AppUser) {
  requireAdmin(actor);
  const email = validateEmail(emailRaw);
  validatePassword(password);
  const file = readAuthFile();
  assertEmailAvailable(file, email);

  const state = addEmployee(name, actor);
  const employee = state.users.find(
    (user) => user.role === "employee" && user.name.toLowerCase() === name.trim().toLowerCase(),
  );
  if (!employee) throw new Error("Не удалось создать сотрудника");
  file.accounts.push({
    userId: employee.id,
    email,
    passwordHash: hashPassword(password),
    sessionVersion: 1,
    mustChangePassword: true,
  });
  writeAuthFile(file);
  return employee;
}

export function saveUserLogin(
  userId: string,
  emailRaw: string,
  newPassword: string,
  actor: AppUser,
) {
  requireAdmin(actor);
  const state = readState();
  const targetUser = state.users.find((user) => user.id === userId);
  if (!targetUser) throw new Error("Пользователь не найден");

  const email = validateEmail(emailRaw);
  const file = readAuthFile();
  assertEmailAvailable(file, email, userId);
  const existing = file.accounts.find((account) => account.userId === userId);
  if (!existing && !newPassword) throw new Error("Задайте пароль для входа");
  if (newPassword) validatePassword(newPassword);

  let next: AuthAccount;
  if (!existing) {
    next = {
      userId,
      email,
      passwordHash: hashPassword(newPassword),
      sessionVersion: 1,
      mustChangePassword: targetUser.id !== actor.id,
    };
  } else if (newPassword) {
    next = {
      ...replaceAccountPassword(existing, newPassword, targetUser.id !== actor.id),
      email,
    };
  } else {
    next = {
      ...existing,
      email,
      sessionVersion: existing.sessionVersion + (email !== existing.email ? 1 : 0),
    };
  }
  file.accounts = [...file.accounts.filter((account) => account.userId !== userId), next];
  writeAuthFile(file);
}

export function changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
  const file = readAuthFile();
  const index = file.accounts.findIndex((account) => account.userId === userId);
  if (index < 0) throw new Error("Для пользователя не настроен вход");
  file.accounts[index] = changeOwnAccountPassword(file.accounts[index], currentPassword, newPassword);
  writeAuthFile(file);
}

export function removeLoginAccount(userId: string) {
  const file = readAuthFile();
  const accounts = file.accounts.filter((account) => account.userId !== userId);
  if (accounts.length === file.accounts.length) return;
  writeAuthFile({ accounts });
}

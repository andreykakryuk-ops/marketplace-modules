import "server-only";
import {hasAccess,type Permission} from "./access";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLoginAccount, isAuthRequired } from "@/lib/auth";
import { readState } from "@/lib/store";
import { DEFAULT_USERS, type AppUser } from "@/lib/types";
import { writeTextFileAtomic } from "@/lib/atomic-file";

export const USER_COOKIE = "wb_user_id";
export const SESSION_COOKIE = "wb_session";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_SECRET_PATH = path.join(process.cwd(), "data", "session-secret");

function getSessionSecret() {
  try {
    const secret = fs.readFileSync(SESSION_SECRET_PATH, "utf8").trim();
    if (secret.length >= 32) return secret;
  } catch {
    // Создадим ключ ниже.
  }
  const secret = crypto.randomBytes(48).toString("base64url");
  writeTextFileAtomic(SESSION_SECRET_PATH, `${secret}\n`, 0o600);
  return secret;
}

function sign(payload: string) {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function parseSessionToken(token: string) {
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  const receivedSignature = token.slice(separator + 1);
  const expectedSignature = sign(payload);
  const receivedBuffer = Buffer.from(receivedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      userId?: unknown;
      sessionVersion?: unknown;
      expiresAt?: unknown;
    };
    const userId = String(parsed.userId ?? "");
    const sessionVersion = Number(parsed.sessionVersion);
    const expiresAt = Number(parsed.expiresAt);
    if (!userId || !Number.isSafeInteger(sessionVersion) || !Number.isSafeInteger(expiresAt)) return null;
    if (expiresAt <= Date.now()) return null;
    return { userId, sessionVersion };
  } catch {
    return null;
  }
}

export async function readSessionUser(): Promise<AppUser | null> {
  const jar = await cookies();
  const state = readState();
  const users = state.users.length ? state.users : DEFAULT_USERS;

  if (!isAuthRequired()) {
    const id = jar.get(USER_COOKIE)?.value;
    return users.find((user) => user.id === id) ?? users.find((user) => user.role === "admin") ?? users[0] ?? null;
  }

  const parsed = parseSessionToken(jar.get(SESSION_COOKIE)?.value ?? "");
  if (!parsed) return null;
  const account = getLoginAccount(parsed.userId);
  if (!account || account.sessionVersion !== parsed.sessionVersion) return null;
  return users.find((user) => user.id === parsed.userId) ?? null;
}

export async function getSessionUser({
  allowPasswordChange = false,
  permission,
}: {
  allowPasswordChange?: boolean;
  permission?: Permission;
} = {}): Promise<AppUser> {
  const user = await readSessionUser();
  if (!user) redirect("/login");
  if (!allowPasswordChange && getLoginAccount(user.id)?.mustChangePassword) {
    redirect("/profile?required=1");
  }
  if (permission && !(await hasAccess(user, permission))) redirect("/no-access");
  return user;
}

export async function createSession(userId: string) {
  const account = getLoginAccount(userId);
  if (!account) throw new Error("Для пользователя не настроен вход");
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      sessionVersion: account.sessionVersion,
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
    }),
  ).toString("base64url");
  const jar = await cookies();
  jar.set(SESSION_COOKIE, `${payload}.${sign(payload)}`, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
  });
  jar.delete(USER_COOKIE);
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(USER_COOKIE);
}

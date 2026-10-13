import assert from "node:assert/strict";
import test from "node:test";
import {
  changeOwnAccountPassword,
  replaceAccountPassword,
} from "@/lib/account-password";
import { hashPassword, verifyPassword } from "@/lib/password";

function account(password = "Временный-пароль-2026") {
  return {
    userId: "employee-1",
    passwordHash: hashPassword(password),
    sessionVersion: 3,
    mustChangePassword: true,
  };
}

test("сотрудник заменяет временный пароль и получает новую версию сессии", () => {
  const currentPassword = "Временный-пароль-2026";
  const newPassword = "Личный-пароль-2026";
  const changed = changeOwnAccountPassword(account(currentPassword), currentPassword, newPassword);

  assert.equal(changed.userId, "employee-1");
  assert.equal(changed.sessionVersion, 4);
  assert.equal(changed.mustChangePassword, false);
  assert.equal(verifyPassword(currentPassword, changed.passwordHash), false);
  assert.equal(verifyPassword(newPassword, changed.passwordHash), true);
});

test("смена пароля проверяет текущий пароль и запрещает повторное использование", () => {
  const existing = account();

  assert.throws(
    () => changeOwnAccountPassword(existing, "неверный-пароль", "Личный-пароль-2026"),
    /Текущий пароль указан неверно/,
  );
  assert.throws(
    () => changeOwnAccountPassword(existing, "Временный-пароль-2026", "Временный-пароль-2026"),
    /должен отличаться/,
  );
});

test("сброс администратором снова делает пароль временным", () => {
  const reset = replaceAccountPassword(account(), "Другой-временный-2026", true);

  assert.equal(reset.sessionVersion, 4);
  assert.equal(reset.mustChangePassword, true);
  assert.equal(verifyPassword("Другой-временный-2026", reset.passwordHash), true);
});

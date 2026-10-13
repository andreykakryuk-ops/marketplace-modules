import assert from "node:assert/strict";
import test from "node:test";
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validatePassword,
  verifyPassword,
} from "@/lib/password";

test("пароль сохраняется как scrypt-хеш и проверяется без хранения исходного текста", () => {
  const password = "Надёжный-пароль-2026";
  const encoded = hashPassword(password);

  assert.match(encoded, /^scrypt\$/);
  assert.equal(encoded.includes(password), false);
  assert.equal(verifyPassword(password, encoded), true);
  assert.equal(verifyPassword("другой-пароль", encoded), false);
  assert.equal(verifyPassword(password, "повреждённый-хеш"), false);
});

test("длина нового пароля ограничена", () => {
  assert.throws(() => validatePassword("x".repeat(PASSWORD_MIN_LENGTH - 1)), /не менее/);
  assert.doesNotThrow(() => validatePassword("x".repeat(PASSWORD_MIN_LENGTH)));
  assert.throws(() => validatePassword("x".repeat(PASSWORD_MAX_LENGTH + 1)), /не более/);
});

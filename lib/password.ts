import crypto from "node:crypto";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;

export function validatePassword(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Пароль должен содержать не менее ${PASSWORD_MIN_LENGTH} символов`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`Пароль должен содержать не более ${PASSWORD_MAX_LENGTH} символов`);
  }
}

export function hashPassword(password: string) {
  validatePassword(password);
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });

  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

export function verifyPassword(password: string, encoded: string) {
  const [algorithm, costRaw, blockSizeRaw, parallelizationRaw, saltRaw, expectedRaw] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltRaw || !expectedRaw) return false;
  const cost = Number(costRaw);
  const blockSize = Number(blockSizeRaw);
  const parallelization = Number(parallelizationRaw);
  if (cost !== SCRYPT_COST || blockSize !== SCRYPT_BLOCK_SIZE || parallelization !== SCRYPT_PARALLELIZATION) {
    return false;
  }

  try {
    const expected = Buffer.from(expectedRaw, "base64url");
    if (expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = crypto.scryptSync(password, Buffer.from(saltRaw, "base64url"), expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

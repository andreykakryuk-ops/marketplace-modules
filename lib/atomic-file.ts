import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function writeTextFileAtomic(filePath: string, contents: string, mode?: number) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;

  try {
    fs.writeFileSync(temporaryPath, contents, {
      encoding: "utf8",
      ...(mode === undefined ? {} : { mode }),
    });
    fs.renameSync(temporaryPath, filePath);
    if (mode !== undefined) fs.chmodSync(filePath, mode);
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Основной файл уже записан; временный файл можно удалить при следующем обслуживании.
    }
  }
}

export function writeJsonFileAtomic(filePath: string, value: unknown, mode?: number, spaces = 2) {
  writeTextFileAtomic(filePath, `${JSON.stringify(value, null, spaces)}\n`, mode);
}

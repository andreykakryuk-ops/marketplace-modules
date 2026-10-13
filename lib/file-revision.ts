import fs from "node:fs";

export function fileRevision(file: string): string {
  try {
    const stat = fs.statSync(file, { bigint: true });
    return [stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

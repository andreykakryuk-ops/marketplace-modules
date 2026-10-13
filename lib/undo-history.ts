import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonFileAtomic } from "./atomic-file";

type Index = { version: 1; past: string[]; future: string[] };
const validId = /^[a-f0-9]{32}$/;

/** One immutable file per snapshot: normal actions never parse or rewrite the full history.
 * The app has one Node writer; keep read/modify/save synchronous, without await.
 */
export class UndoHistory<T> {
  private readonly indexPath: string;
  private readonly snapshotsDir: string;
  private readonly legacyPath: string;

  constructor(directory: string, private readonly limit = 400) {
    this.indexPath = path.join(directory, "undo-history.json");
    this.snapshotsDir = path.join(directory, "undo-snapshots");
    this.legacyPath = path.join(directory, "undo-stack.json");
  }

  private read(): Index {
    if (fs.existsSync(this.indexPath)) {
      const value = JSON.parse(fs.readFileSync(this.indexPath, "utf8")) as Index;
      if (value.version !== 1 || !Array.isArray(value.past) || !Array.isArray(value.future) ||
          ![...value.past, ...value.future].every(id => typeof id === "string" && validId.test(id))) {
        throw new Error("Повреждён индекс отмен. Нужна проверка резервной копии.");
      }
      return value;
    }
    const index: Index = { version: 1, past: [], future: [] };
    if (!fs.existsSync(this.legacyPath)) return index;
    const legacy = JSON.parse(fs.readFileSync(this.legacyPath, "utf8")) as { past: T[]; future: T[] };
    if (!Array.isArray(legacy.past) || !Array.isArray(legacy.future)) {
      throw new Error("Повреждена история отмен. Исходный файл сохранён.");
    }
    // Publish the index only after every legacy snapshot is safely written.
    // Leave the legacy file intact as a migration backup.
    index.past = legacy.past.map(value => this.snapshot(value));
    index.future = legacy.future.map(value => this.snapshot(value));
    writeJsonFileAtomic(this.indexPath, index, undefined, 0);
    return index;
  }

  private snapshot(value: T): string {
    const id = crypto.randomBytes(16).toString("hex");
    writeJsonFileAtomic(path.join(this.snapshotsDir, id + ".json"), value, undefined, 0);
    return id;
  }

  private resolve(id: string): T {
    return JSON.parse(fs.readFileSync(path.join(this.snapshotsDir, id + ".json"), "utf8")) as T;
  }

  private save(index: Index, obsolete: string[]) {
    writeJsonFileAtomic(this.indexPath, index, undefined, 0);
    // Best-effort collection only after the new index is committed.
    // A cleanup failure must not turn a successful action into an error.
    const retained = new Set([...index.past, ...index.future]);
    for (const id of obsolete) {
      if (retained.has(id)) continue;
      try { fs.unlinkSync(path.join(this.snapshotsDir, id + ".json")); } catch { /* Retry during maintenance. */ }
    }
  }

  meta() {
    const index = this.read();
    return { canUndo: index.past.length > 0, canRedo: index.future.length > 0 };
  }

  record(previous: T) {
    const index = this.read();
    const obsolete = index.future;
    index.future = [];
    index.past.push(this.snapshot(previous));
    if (index.past.length > this.limit) obsolete.push(...index.past.splice(0, index.past.length - this.limit));
    this.save(index, obsolete);
  }

  undo(current: T): T {
    return this.move(current, "past", "future", "Нечего отменять");
  }

  redo(current: T): T {
    return this.move(current, "future", "past", "Нечего вернуть");
  }

  private move(current: T, from: "past" | "future", to: "past" | "future", message: string): T {
    const index = this.read();
    const id = index[from].pop();
    if (!id) throw new Error(message);
    // Read before changing anything: a missing/corrupt snapshot must not erase history.
    const target = this.resolve(id);
    index[to].push(this.snapshot(current));
    this.save(index, [id]);
    return target;
  }
}

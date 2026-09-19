import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hash, requireThat } from "./domain.js";

export function openStore(file) {
  if (file !== ":memory:")
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, parent_id TEXT REFERENCES records(id), created_at TEXT NOT NULL, body TEXT NOT NULL, sha256 TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS records_no_update BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT,'immutable record'); END;
    CREATE TRIGGER IF NOT EXISTS records_no_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT,'immutable record'); END;
    PRAGMA user_version=1;`);
  return {
    add(kind, body, parentId = null) {
      const record = {
        id: randomUUID(),
        kind,
        parentId,
        createdAt: new Date().toISOString(),
        body: structuredClone(body),
      };
      record.sha256 = hash(record);
      db.prepare("INSERT INTO records VALUES (?,?,?,?,?,?)").run(
        record.id,
        kind,
        parentId,
        record.createdAt,
        JSON.stringify(record.body),
        record.sha256,
      );
      return record;
    },
    get(id) {
      requireThat(
        typeof id === "string" && /^[a-f0-9-]{36}$/.test(id),
        "Identificatore del record non valido.",
      );
      const row = db.prepare("SELECT * FROM records WHERE id=?").get(id);
      requireThat(row, "Record non trovato.", 404);
      const record = {
        id: row.id,
        kind: row.kind,
        parentId: row.parent_id,
        createdAt: row.created_at,
        body: JSON.parse(row.body),
      };
      requireThat(
        hash(record) === row.sha256,
        "Integrità del record non valida.",
        500,
      );
      return { ...record, sha256: row.sha256 };
    },
    list(kind = "snapshot") {
      return db
        .prepare("SELECT id FROM records WHERE kind=? ORDER BY created_at DESC")
        .all(kind)
        .map((r) => this.get(r.id));
    },
    close() {
      db.close();
    },
  };
}

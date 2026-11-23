// Sandbox rig: stands in for better-sqlite3 (a native module) with Node's built-in node:sqlite.
// Only what the sync-service and better-auth's kysely dialect use. Never used in production.
import { DatabaseSync } from "node:sqlite";

const fix = (args) => {
  const a = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  return a.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v instanceof Date ? v.toISOString() : v));
};

// better-sqlite3 names constraint errors in `code`; callers branch on it
function named(fn) {
  try {
    return fn();
  } catch (err) {
    const m = /^(UNIQUE|PRIMARY KEY|NOT NULL|FOREIGN KEY|CHECK) constraint failed/.exec(err?.message ?? "");
    if (m) err.code = `SQLITE_CONSTRAINT_${m[1] === "PRIMARY KEY" ? "PRIMARYKEY" : m[1].replace(" ", "")}`;
    throw err;
  }
}

class Statement {
  constructor(stmt, sql) {
    this.stmt = stmt;
    this.reader = /^\s*(select|pragma|with|explain)\b/i.test(sql) || /\breturning\b/i.test(sql);
  }
  run(...args) { return named(() => this.stmt.run(...fix(args))); }
  get(...args) { return named(() => this.stmt.get(...fix(args))); }
  all(...args) { return named(() => this.stmt.all(...fix(args))); }
  iterate(...args) { return this.stmt.all(...fix(args))[Symbol.iterator](); }
}

export default class Database {
  constructor(path, _opts = {}) {
    this.raw = new DatabaseSync(path);
    this.depth = 0;
  }
  prepare(sql) { return new Statement(this.raw.prepare(sql), sql); }
  exec(sql) { this.raw.exec(sql); return this; }
  pragma(text, opts = {}) {
    const rows = this.raw.prepare(`PRAGMA ${text}`).all();
    return opts.simple ? Object.values(rows[0] ?? {})[0] : rows;
  }
  transaction(fn) {
    return (...args) => {
      const name = `sp${this.depth}`;
      this.raw.exec(this.depth === 0 ? "BEGIN" : `SAVEPOINT ${name}`);
      this.depth++;
      try {
        const out = fn(...args);
        this.depth--;
        this.raw.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${name}`);
        return out;
      } catch (err) {
        this.depth--;
        this.raw.exec(this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
        throw err;
      }
    };
  }
  // better-auth recognises better-sqlite3 by this method
  aggregate() { throw new Error("aggregate: not in the rig"); }
  close() { this.raw.close(); }
}

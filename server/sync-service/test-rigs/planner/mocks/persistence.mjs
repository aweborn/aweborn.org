import { DatabaseSync } from "node:sqlite";
let d = null;
export function getDb() { if (!d) d = new DatabaseSync(":memory:"); return d; }

import { DatabaseSync } from "node:sqlite";

/** Open (and migrate) the Pinline SQLite database. */
export function openDb(path: string = process.env.PINLINE_DB ?? "pinline.db"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA cache_size = -8000;");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS teams    (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS persons  (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS assets   (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);

    CREATE TABLE IF NOT EXISTS pins (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      type              TEXT NOT NULL CHECK (type IN ('task','followup','finding')),
      importance        TEXT NOT NULL CHECK (importance IN ('critical','high','medium','low')),
      status            TEXT NOT NULL CHECK (status IN ('open','in_progress','blocked','done')),
      created           TEXT NOT NULL,
      last_touched      TEXT NOT NULL,
      due               TEXT,
      nudge             TEXT,
      snooze            TEXT,
      closed            TEXT,
      severity          TEXT CHECK (severity IS NULL OR severity IN ('critical','high','medium','low','info')),
      remediation_state TEXT CHECK (remediation_state IS NULL OR remediation_state IN ('triaged','in_remediation','remediated','verified','accepted_risk','false_positive')),
      reference         TEXT,
      project_id        TEXT REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS pin_teams (
      pin_id  TEXT NOT NULL REFERENCES pins(id)  ON DELETE CASCADE,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      PRIMARY KEY (pin_id, team_id)
    );
    CREATE TABLE IF NOT EXISTS pin_persons (
      pin_id    TEXT NOT NULL REFERENCES pins(id)    ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      PRIMARY KEY (pin_id, person_id)
    );
    CREATE TABLE IF NOT EXISTS pin_assets (
      pin_id   TEXT NOT NULL REFERENCES pins(id)   ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      PRIMARY KEY (pin_id, asset_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pins_created ON pins(created DESC);
  `);

  // Back-fill columns added after the initial schema.
  const cols = db.prepare("PRAGMA table_info(pins)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "project_id")) {
    db.exec("ALTER TABLE pins ADD COLUMN project_id TEXT REFERENCES projects(id)");
  }
  if (!cols.some((c) => c.name === "description")) {
    db.exec("ALTER TABLE pins ADD COLUMN description TEXT");
  }
}

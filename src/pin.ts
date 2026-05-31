import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export type PinType = "task" | "followup" | "finding";
export type Importance = "critical" | "high" | "medium" | "low";
export type Status = "open" | "in_progress" | "blocked" | "done";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type RemediationState =
  | "triaged"
  | "in_remediation"
  | "remediated"
  | "verified"
  | "accepted_risk"
  | "false_positive";

/** A Pin as exposed by the API: scalar fields plus its resolved dimension names. */
export interface Pin {
  id: string;
  title: string;
  type: PinType;
  importance: Importance;
  status: Status;
  created: string;
  last_touched: string;
  due: string | null;
  nudge: string | null;
  snooze: string | null;
  closed: string | null;
  severity: Severity | null;
  remediation_state: RemediationState | null;
  reference: string | null;
  description: string | null;
  project: string | null; // container — at most one
  teams: string[];
  persons: string[];
  assets: string[];
}

/** The raw `pins` row: scalar columns plus the project foreign key. */
interface PinRow {
  id: string;
  title: string;
  type: PinType;
  importance: Importance;
  status: Status;
  created: string;
  last_touched: string;
  due: string | null;
  nudge: string | null;
  snooze: string | null;
  closed: string | null;
  severity: Severity | null;
  remediation_state: RemediationState | null;
  reference: string | null;
  description: string | null;
  project_id: string | null;
}

interface PinListRow extends PinRow {
  project_name: string | null;
  teams_csv:    string | null;
  persons_csv:  string | null;
  assets_csv:   string | null;
}

export interface CreatePinInput {
  title: string;
  type?: PinType;
  importance?: Importance;
  status?: Status;
  due?: string | null;
  nudge?: string | null;
  snooze?: string | null;
  severity?: Severity | null;
  remediation_state?: RemediationState | null;
  reference?: string | null;
  description?: string | null;
  project?: string | null;
  teams?: string[];
  persons?: string[];
  assets?: string[];
}

/** Patchable fields. Providing a dimension array replaces that dimension's links. */
export interface UpdatePinInput {
  title?: string;
  type?: PinType;
  importance?: Importance;
  status?: Status;
  due?: string | null;
  nudge?: string | null;
  snooze?: string | null;
  closed?: string | null;
  severity?: Severity | null;
  remediation_state?: RemediationState | null;
  reference?: string | null;
  description?: string | null;
  project?: string | null;
  teams?: string[];
  persons?: string[];
  assets?: string[];
}

const ROW_COLUMNS = [
  "id", "title", "type", "importance", "status", "created", "last_touched",
  "due", "nudge", "snooze", "closed", "severity", "remediation_state", "reference", "description", "project_id",
] as const;

const UPDATABLE = ROW_COLUMNS.filter((c) => c !== "id" && c !== "created");

/** A Finding's severity sets its default importance (overridable by an explicit importance). */
const SEVERITY_IMPORTANCE: Record<Severity, Importance> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  info: "low",
};

const JOINS = {
  teams: { table: "pin_teams", col: "team_id", dim: "teams" },
  persons: { table: "pin_persons", col: "person_id", dim: "persons" },
  assets: { table: "pin_assets", col: "asset_id", dim: "assets" },
} as const;

function now(): string {
  return new Date().toISOString();
}

// --- dimension helpers (table names are internal constants, never user input) ---

function resolveName(db: DatabaseSync, table: string, name: string): string {
  const trimmed = name.trim();
  const found = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(trimmed) as { id: string } | undefined;
  if (found) return found.id;
  const id = randomUUID();
  db.prepare(`INSERT INTO ${table} (id, name) VALUES (?, ?)`).run(id, trimmed);
  return id;
}

function nameById(db: DatabaseSync, table: string, id: string): string | null {
  const row = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as { name: string } | undefined;
  return row ? row.name : null;
}

function namesFor(db: DatabaseSync, join: { table: string; col: string; dim: string }, pinId: string): string[] {
  const rows = db
    .prepare(`SELECT d.name AS name FROM ${join.table} j JOIN ${join.dim} d ON d.id = j.${join.col} WHERE j.pin_id = ? ORDER BY d.name`)
    .all(pinId) as { name: string }[];
  return rows.map((r) => r.name);
}

function clearDims(db: DatabaseSync, join: { table: string; col: string }, pinId: string): void {
  db.prepare(`DELETE FROM ${join.table} WHERE pin_id = ?`).run(pinId);
}

function linkDims(db: DatabaseSync, join: { table: string; col: string; dim: string }, pinId: string, names: string[] | undefined): void {
  const unique = [...new Set((names ?? []).map((n) => n.trim()).filter(Boolean))];
  for (const name of unique) {
    const id = resolveName(db, join.dim, name);
    db.prepare(`INSERT OR IGNORE INTO ${join.table} (pin_id, ${join.col}) VALUES (?, ?)`).run(pinId, id);
  }
}

function assemble(db: DatabaseSync, row: PinRow): Pin {
  const { project_id, ...scalar } = row;
  return {
    ...scalar,
    project: project_id ? nameById(db, "projects", project_id) : null,
    teams: namesFor(db, JOINS.teams, row.id),
    persons: namesFor(db, JOINS.persons, row.id),
    assets: namesFor(db, JOINS.assets, row.id),
  };
}

function getRow(db: DatabaseSync, id: string): PinRow | undefined {
  return db.prepare("SELECT * FROM pins WHERE id = ?").get(id) as unknown as PinRow | undefined;
}

function insertRow(db: DatabaseSync, row: PinRow): void {
  const placeholders = ROW_COLUMNS.map(() => "?").join(", ");
  db.prepare(`INSERT INTO pins (${ROW_COLUMNS.join(", ")}) VALUES (${placeholders})`)
    .run(...ROW_COLUMNS.map((c) => row[c]));
}

function writeRow(db: DatabaseSync, row: PinRow): void {
  const setClause = UPDATABLE.map((c) => `${c} = ?`).join(", ");
  db.prepare(`UPDATE pins SET ${setClause} WHERE id = ?`).run(...UPDATABLE.map((c) => row[c]), row.id);
}

function listPinsRaw(db: DatabaseSync): Pin[] {
  const rows = db.prepare(`
    SELECT
      p.*,
      pr.name                        AS project_name,
      GROUP_CONCAT(DISTINCT t.name)  AS teams_csv,
      GROUP_CONCAT(DISTINCT pe.name) AS persons_csv,
      GROUP_CONCAT(DISTINCT a.name)  AS assets_csv
    FROM pins p
    LEFT JOIN projects   pr ON pr.id     = p.project_id
    LEFT JOIN pin_teams  pt ON pt.pin_id = p.id
    LEFT JOIN teams       t ON t.id      = pt.team_id
    LEFT JOIN pin_persons pp ON pp.pin_id = p.id
    LEFT JOIN persons    pe  ON pe.id    = pp.person_id
    LEFT JOIN pin_assets pa  ON pa.pin_id = p.id
    LEFT JOIN assets      a  ON a.id     = pa.asset_id
    GROUP BY p.id
    ORDER BY p.created DESC
  `).all() as unknown as PinListRow[];

  return rows.map((r) => {
    const { project_id, project_name, teams_csv, persons_csv, assets_csv, ...scalar } = r;
    return {
      ...scalar,
      project:  project_name ?? null,
      teams:    teams_csv   ? teams_csv.split(",").sort()   : [],
      persons:  persons_csv ? persons_csv.split(",").sort() : [],
      assets:   assets_csv  ? assets_csv.split(",").sort()  : [],
    };
  });
}

// --- public API ---

export function createPin(db: DatabaseSync, input: CreatePinInput): Pin {
  if (!input.title || !input.title.trim()) {
    throw new Error("title is required");
  }
  const ts = now();
  const row: PinRow = {
    id: randomUUID(),
    title: input.title,
    type: input.type ?? "task",
    importance: input.importance ?? (input.severity ? SEVERITY_IMPORTANCE[input.severity] : "medium"),
    status: input.status ?? "open",
    created: ts,
    last_touched: ts,
    due: input.due ?? null,
    nudge: input.nudge ?? null,
    snooze: input.snooze ?? null,
    closed: null,
    severity: input.severity ?? null,
    remediation_state: input.remediation_state ?? null,
    reference: input.reference ?? null,
    description: input.description ?? null,
    project_id: input.project ? resolveName(db, "projects", input.project) : null,
  };
  insertRow(db, row);
  linkDims(db, JOINS.teams, row.id, input.teams);
  linkDims(db, JOINS.persons, row.id, input.persons);
  linkDims(db, JOINS.assets, row.id, input.assets);
  return assemble(db, row);
}

export function getPin(db: DatabaseSync, id: string): Pin | undefined {
  const row = getRow(db, id);
  return row ? assemble(db, row) : undefined;
}

export function listPins(db: DatabaseSync): Pin[] {
  return listPinsRaw(db);
}

export function updatePin(db: DatabaseSync, id: string, patch: UpdatePinInput): Pin | undefined {
  const row = getRow(db, id);
  if (!row) return undefined;

  const merged: PinRow = { ...row };
  const scalars = ["title", "type", "importance", "status", "due", "nudge", "snooze", "severity", "remediation_state", "reference", "description"] as const;
  for (const c of scalars) {
    if (patch[c] !== undefined) (merged[c] as PinRow[typeof c]) = patch[c] as PinRow[typeof c];
  }

  if (patch.project !== undefined) {
    merged.project_id = patch.project ? resolveName(db, "projects", patch.project) : null;
  }

  // closed tracks the done transition unless the caller set it explicitly
  if (patch.closed !== undefined) {
    merged.closed = patch.closed;
  } else if (patch.status === "done" && row.status !== "done") {
    merged.closed = now();
  } else if (patch.status !== undefined && patch.status !== "done") {
    merged.closed = null;
  }

  merged.last_touched = now();
  writeRow(db, merged);

  // Replace dimension links when the patch provides them (undefined = leave as-is).
  if (patch.teams !== undefined) {
    clearDims(db, JOINS.teams, id);
    linkDims(db, JOINS.teams, id, patch.teams);
  }
  if (patch.persons !== undefined) {
    clearDims(db, JOINS.persons, id);
    linkDims(db, JOINS.persons, id, patch.persons);
  }
  if (patch.assets !== undefined) {
    clearDims(db, JOINS.assets, id);
    linkDims(db, JOINS.assets, id, patch.assets);
  }

  return assemble(db, merged);
}

export function deletePin(db: DatabaseSync, id: string): boolean {
  return db.prepare("DELETE FROM pins WHERE id = ?").run(id).changes > 0;
}

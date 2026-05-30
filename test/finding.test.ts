import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { openDb } from "../src/db.ts";
import { createPin, getPin, updatePin } from "../src/pin.ts";
import { parseQuickAdd } from "../src/quickadd.ts";

const NOW = new Date("2026-05-29T12:00:00.000Z");

function withDb(fn: (db: ReturnType<typeof openDb>) => void): void {
  const path = join(tmpdir(), `pinline-find-${randomUUID()}.db`);
  const db = openDb(path);
  try {
    fn(db);
  } finally {
    db.close();
    for (const s of ["", "-wal", "-shm"]) rmSync(path + s, { force: true });
  }
}

test("sev: parses severity and implies %finding when no type is given", () => {
  const p = parseQuickAdd("sev:high =api-gw expired cert #infra", NOW);
  assert.equal(p.severity, "high");
  assert.equal(p.type, "finding");
  assert.equal(p.title, "expired cert");
});

test("an explicit %type is respected even with sev:", () => {
  const p = parseQuickAdd("%task sev:low tidy logs", NOW);
  assert.equal(p.type, "task");
  assert.equal(p.severity, "low");
});

test("unknown severity warns and falls into the title", () => {
  const p = parseQuickAdd("sev:spicy fix it", NOW);
  assert.equal(p.severity, undefined);
  assert.equal(p.title, "sev:spicy fix it");
  assert.match(p.warnings[0], /unknown severity/);
});

test("severity sets default importance; an explicit importance overrides it", () => {
  withDb((db) => {
    const fromSeverity = createPin(db, { title: "a", type: "finding", severity: "critical" });
    assert.equal(fromSeverity.importance, "critical");

    const overridden = createPin(db, { title: "b", type: "finding", severity: "critical", importance: "low" });
    assert.equal(overridden.importance, "low");

    const infoMapsLow = createPin(db, { title: "c", type: "finding", severity: "info" });
    assert.equal(infoMapsLow.importance, "low");
  });
});

test("remediation_state can be set and cleared via update", () => {
  withDb((db) => {
    const p = createPin(db, { title: "x", type: "finding", severity: "high" });
    assert.equal(p.remediation_state, null);

    const triaged = updatePin(db, p.id, { remediation_state: "triaged" });
    assert.equal(triaged?.remediation_state, "triaged");
    assert.equal(getPin(db, p.id)?.remediation_state, "triaged");

    const cleared = updatePin(db, p.id, { remediation_state: null });
    assert.equal(cleared?.remediation_state, null);
  });
});

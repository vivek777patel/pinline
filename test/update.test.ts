import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { openDb } from "../src/db.ts";
import { createPin, getPin, updatePin } from "../src/pin.ts";

function withDb(fn: (db: ReturnType<typeof openDb>) => void): void {
  const path = join(tmpdir(), `pinline-upd-${randomUUID()}.db`);
  const db = openDb(path);
  try {
    fn(db);
  } finally {
    db.close();
    for (const s of ["", "-wal", "-shm"]) rmSync(path + s, { force: true });
  }
}

test("updatePin edits scalars, a date, project, and replaces dimensions", () => {
  withDb((db) => {
    const p = createPin(db, {
      title: "x",
      type: "finding",
      project: "infra",
      teams: ["platform"],
      assets: ["a1"],
    });

    const u = updatePin(db, p.id, {
      title: "y",
      importance: "low",
      due: "2026-07-01T00:00:00.000Z",
      project: "payments",
      teams: ["secops", "appsec"],
      assets: [],
      persons: ["priya"],
    });

    assert.ok(u);
    assert.equal(u.title, "y");
    assert.equal(u.importance, "low");
    assert.equal(u.due, "2026-07-01T00:00:00.000Z");
    assert.equal(u.project, "payments");
    assert.deepEqual(u.teams, ["appsec", "secops"]); // returned sorted by name
    assert.deepEqual(u.assets, []); // replaced with empty
    assert.deepEqual(u.persons, ["priya"]); // added

    const g = getPin(db, p.id);
    assert.deepEqual(g?.teams, ["appsec", "secops"]);
    assert.equal(g?.assets.length, 0);
  });
});

test("a dimension omitted from the patch is left unchanged", () => {
  withDb((db) => {
    const p = createPin(db, { title: "x", teams: ["platform"] });
    const u = updatePin(db, p.id, { title: "y" }); // no teams key at all
    assert.deepEqual(u?.teams, ["platform"]);
  });
});

test("clearing a date sets it to null", () => {
  withDb((db) => {
    const p = createPin(db, { title: "x", due: "2026-07-01T00:00:00.000Z" });
    const u = updatePin(db, p.id, { due: null });
    assert.equal(u?.due, null);
  });
});

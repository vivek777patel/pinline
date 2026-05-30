import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { openDb } from "../src/db.ts";
import { createPin, getPin, deletePin } from "../src/pin.ts";

function withDb(fn: (db: ReturnType<typeof openDb>) => void): void {
  const path = join(tmpdir(), `pinline-dim-${randomUUID()}.db`);
  const db = openDb(path);
  try {
    fn(db);
  } finally {
    db.close();
    for (const s of ["", "-wal", "-shm"]) rmSync(path + s, { force: true });
  }
}

test("createPin persists project + multi-valued dimensions and reads them back", () => {
  withDb((db) => {
    const created = createPin(db, {
      title: "expired cert",
      type: "finding",
      project: "infra",
      teams: ["platform", "secops"],
      persons: ["priya"],
      assets: ["api-gw"],
    });
    assert.equal(created.project, "infra");
    assert.deepEqual(created.teams, ["platform", "secops"]);
    assert.deepEqual(created.assets, ["api-gw"]);

    const fetched = getPin(db, created.id);
    assert.equal(fetched?.project, "infra");
    assert.deepEqual(fetched?.persons, ["priya"]);
  });
});

test("dimensions are de-duplicated within a Pin and reused across Pins", () => {
  withDb((db) => {
    const a = createPin(db, { title: "a", teams: ["platform", "platform"] });
    assert.deepEqual(a.teams, ["platform"], "duplicate team collapses");

    createPin(db, { title: "b", teams: ["platform"] });
    const teamCount = (db.prepare("SELECT COUNT(*) AS n FROM teams").get() as { n: number }).n;
    assert.equal(teamCount, 1, "the team row is shared, not duplicated");
  });
});

test("a Pin with no dimensions reads back as null / empty arrays", () => {
  withDb((db) => {
    const p = createPin(db, { title: "plain task" });
    assert.equal(p.project, null);
    assert.deepEqual(p.teams, []);
    assert.deepEqual(p.persons, []);
    assert.deepEqual(p.assets, []);
  });
});

test("deleting a Pin cascades its dimension links (but keeps the dimension rows)", () => {
  withDb((db) => {
    const p = createPin(db, { title: "x", teams: ["platform"], assets: ["api-gw"] });
    assert.equal(deletePin(db, p.id), true);

    const links = (db.prepare("SELECT COUNT(*) AS n FROM pin_teams").get() as { n: number }).n;
    assert.equal(links, 0, "join rows are gone");
    const teams = (db.prepare("SELECT COUNT(*) AS n FROM teams").get() as { n: number }).n;
    assert.equal(teams, 1, "the team itself survives for reuse");
  });
});

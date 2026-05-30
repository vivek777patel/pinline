import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";

import { openDb } from "../src/db.ts";
import type { Pin } from "../src/pin.ts";
import { createPin, getPin, listPins, updatePin, deletePin } from "../src/pin.ts";
import { createServer } from "../src/server.ts";

function tmpDbPath(): string {
  return join(tmpdir(), `pinline-test-${randomUUID()}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
}

test("a Pin round-trips to the DB file across connections", () => {
  const path = tmpDbPath();
  let db = openDb(path);
  try {
    const created = createPin(db, {
      title: "rotate prod API keys",
      type: "finding",
      severity: "high",
      due: "2026-06-05T00:00:00.000Z",
    });
    assert.equal(created.type, "finding");
    assert.equal(created.importance, "high"); // derived from severity:high
    assert.equal(created.status, "open"); // default
    assert.equal(created.closed, null);
    assert.ok(created.created);

    // Reopen a *fresh* connection to the same file — proves it persisted to disk.
    db.close();
    db = openDb(path);

    const fetched = getPin(db, created.id);
    assert.deepEqual({ ...fetched }, created);
  } finally {
    db.close();
    cleanup(path);
  }
});

test("update patches fields, bumps last_touched, and tracks done -> closed", async () => {
  const path = tmpDbPath();
  const db = openDb(path);
  try {
    const pin = createPin(db, { title: "draft report" });
    await new Promise((r) => setTimeout(r, 2)); // ensure timestamps differ

    const updated = updatePin(db, pin.id, { title: "draft Q2 report", status: "done" });
    assert.ok(updated);
    assert.equal(updated.title, "draft Q2 report");
    assert.equal(updated.status, "done");
    assert.ok(updated.closed, "closed should be set on done transition");
    assert.notEqual(updated.last_touched, pin.last_touched);
    assert.equal(updated.created, pin.created, "created is immutable");

    // reopening to non-done clears closed
    const reopened = updatePin(db, pin.id, { status: "open" });
    assert.equal(reopened?.closed, null);

    assert.equal(updatePin(db, "no-such-id", { title: "x" }), undefined);
  } finally {
    db.close();
    cleanup(path);
  }
});

test("title is required", () => {
  const path = tmpDbPath();
  const db = openDb(path);
  try {
    assert.throws(() => createPin(db, { title: "  " }), /title is required/);
  } finally {
    db.close();
    cleanup(path);
  }
});

test("list and delete", () => {
  const path = tmpDbPath();
  const db = openDb(path);
  try {
    const a = createPin(db, { title: "a" });
    createPin(db, { title: "b" });
    assert.equal(listPins(db).length, 2);

    assert.equal(deletePin(db, a.id), true);
    assert.equal(deletePin(db, a.id), false);
    assert.equal(getPin(db, a.id), undefined);
    assert.equal(listPins(db).length, 1);
  } finally {
    db.close();
    cleanup(path);
  }
});

test("HTTP CRUD round-trip", async () => {
  const path = tmpDbPath();
  const db = openDb(path);
  const server = createServer(db).listen(0);
  const { port } = server.address() as AddressInfo;
  const base = `http://localhost:${port}/api/pins`;
  const json = { "content-type": "application/json" };

  try {
    const created = (await (
      await fetch(base, { method: "POST", headers: json, body: JSON.stringify({ title: "ship it", type: "task" }) })
    ).json()) as Pin;
    assert.equal(created.title, "ship it");

    const fetched = (await (await fetch(`${base}/${created.id}`)).json()) as Pin;
    assert.deepEqual(fetched, created);

    const patched = (await (
      await fetch(`${base}/${created.id}`, { method: "PATCH", headers: json, body: JSON.stringify({ importance: "high" }) })
    ).json()) as Pin;
    assert.equal(patched.importance, "high");

    const list = (await (await fetch(base)).json()) as Pin[];
    assert.equal(list.length, 1);

    const del = await fetch(`${base}/${created.id}`, { method: "DELETE" });
    assert.equal(del.status, 204);

    const missing = await fetch(`${base}/${created.id}`);
    assert.equal(missing.status, 404);

    const bad = await fetch(base, { method: "POST", headers: json, body: JSON.stringify({ title: "" }) });
    assert.equal(bad.status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    cleanup(path);
  }
});

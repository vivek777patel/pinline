import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { AddressInfo } from "node:net";

import { parseDate, parseQuickAdd } from "../src/quickadd.ts";
import { openDb } from "../src/db.ts";
import { createServer } from "../src/server.ts";

const NOW = new Date("2026-05-29T12:00:00.000Z");
const at = (days: number): string => new Date(NOW.getTime() + days * 86_400_000).toISOString();

test("parses a full line into every field, title is the leftover", () => {
  const p = parseQuickAdd(
    "%finding =api-gw expired TLS cert #infra ~platform !high due:tomorrow @priya",
    NOW,
  );
  assert.equal(p.type, "finding");
  assert.equal(p.importance, "high");
  assert.equal(p.project, "infra");
  assert.deepEqual(p.teams, ["platform"]);
  assert.deepEqual(p.persons, ["priya"]);
  assert.deepEqual(p.assets, ["api-gw"]);
  assert.equal(p.due, at(1));
  assert.equal(p.title, "expired TLS cert");
  assert.deepEqual(p.warnings, []);
});

test("type defaults to task; importance left unset when absent", () => {
  const p = parseQuickAdd("call the vendor", NOW);
  assert.equal(p.type, "task");
  assert.equal(p.importance, undefined);
  assert.equal(p.title, "call the vendor");
});

test("accumulates multiple persons / teams / assets; first project wins with a warning", () => {
  const p = parseQuickAdd("@a @b ~x ~y =h1 =h2 #p1 #p2 thing", NOW);
  assert.deepEqual(p.persons, ["a", "b"]);
  assert.deepEqual(p.teams, ["x", "y"]);
  assert.deepEqual(p.assets, ["h1", "h2"]);
  assert.equal(p.project, "p1");
  assert.equal(p.warnings.length, 1);
  assert.match(p.warnings[0], /multiple projects/);
  assert.equal(p.title, "thing");
});

test("unknown %type / !importance warn and fall back into the title", () => {
  const p = parseQuickAdd("%bogus !urgent fix it", NOW);
  assert.equal(p.type, "task");
  assert.equal(p.importance, undefined);
  assert.equal(p.title, "%bogus !urgent fix it");
  assert.equal(p.warnings.length, 2);
});

test("bare sigils are treated as plain text", () => {
  const p = parseQuickAdd("email @ me # later", NOW);
  assert.equal(p.title, "email @ me # later");
  assert.deepEqual(p.persons, []);
});

test("nudge and snooze tokens parse; bad dates warn and stay in title", () => {
  const p = parseQuickAdd("chase nudge:3d snooze:notaday", NOW);
  assert.equal(p.nudge, at(3));
  assert.equal(p.snooze, null);
  assert.match(p.warnings[0], /couldn't parse date/);
  assert.equal(p.title, "chase snooze:notaday");
});

test("parseDate handles the supported forms", () => {
  assert.equal(parseDate("today", NOW), at(0));
  assert.equal(parseDate("tomorrow", NOW), at(1));
  assert.equal(parseDate("yesterday", NOW), at(-1));
  assert.equal(parseDate("2w", NOW), at(14));
  assert.equal(parseDate("2026-06-05", NOW), "2026-06-05T00:00:00.000Z");
  assert.equal(parseDate("gibberish", NOW), null);

  const fri = parseDate("fri", NOW);
  assert.ok(fri);
  assert.equal(new Date(fri).getUTCDay(), 5, "resolves to a Friday");
  const ahead = (new Date(fri).getTime() - NOW.getTime()) / 86_400_000;
  assert.ok(ahead > 0 && ahead <= 7, "within the coming week");
});

test("HTTP /api/pins/quick creates a Pin and echoes parsed dimensions", async () => {
  const path = join(tmpdir(), `pinline-qa-${randomUUID()}.db`);
  const db = openDb(path);
  const server = createServer(db).listen(0);
  const { port } = server.address() as AddressInfo;
  const url = `http://localhost:${port}/api/pins/quick`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "%finding =api-gw rotate keys #infra !high" }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      pin: { id: string; type: string; title: string; importance: string; project: string | null; assets: string[] };
    };

    assert.equal(body.pin.type, "finding");
    assert.equal(body.pin.title, "rotate keys");
    assert.equal(body.pin.importance, "high");
    assert.deepEqual(body.pin.assets, ["api-gw"]); // now persisted on the Pin
    assert.equal(body.pin.project, "infra");

    // and it survives a re-read
    const reread = (await (await fetch(`http://localhost:${port}/api/pins/${body.pin.id}`)).json()) as {
      project: string | null;
      assets: string[];
    };
    assert.equal(reread.project, "infra");
    assert.deepEqual(reread.assets, ["api-gw"]);

    // A line with only dimensions has no title -> create rejects it.
    const empty = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "@priya #infra" }),
    });
    assert.equal(empty.status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    for (const s of ["", "-wal", "-shm"]) rmSync(path + s, { force: true });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { Pin } from "../src/pin.ts";
import { isSnoozed, prioritize, urgency } from "../src/priority.ts";

const NOW = new Date("2026-05-29T12:00:00.000Z");
const at = (daysFromNow: number): string =>
  new Date(NOW.getTime() + daysFromNow * 86_400_000).toISOString();

function makePin(o: Partial<Pin> = {}): Pin {
  return {
    id: o.id ?? randomUUID(),
    title: o.title ?? "t",
    type: o.type ?? "task",
    importance: o.importance ?? "medium",
    status: o.status ?? "open",
    created: o.created ?? NOW.toISOString(),
    last_touched: o.last_touched ?? NOW.toISOString(),
    due: o.due ?? null,
    nudge: o.nudge ?? null,
    snooze: o.snooze ?? null,
    closed: o.closed ?? null,
    severity: o.severity ?? null,
    remediation_state: o.remediation_state ?? null,
    reference: o.reference ?? null,
    project: o.project ?? null,
    teams: o.teams ?? [],
    persons: o.persons ?? [],
    assets: o.assets ?? [],
  };
}

test("urgency reflects each signal with the ADR-0001 defaults", () => {
  assert.equal(urgency(makePin(), NOW), 0, "a fresh, dateless Pin is not urgent");
  assert.equal(urgency(makePin({ due: at(-2) }), NOW), 56, "overdue 2d → 50 + 3*2");
  assert.equal(urgency(makePin({ due: at(1) }), NOW), 27, "due in 1d → ramp ~27");
  assert.equal(urgency(makePin({ due: at(5) }), NOW), 0, "due beyond the 3d window → no boost");
  assert.equal(urgency(makePin({ last_touched: at(-10) }), NOW), 6, "stale 10d → (10-7)*2");
  assert.equal(urgency(makePin({ nudge: at(-1) }), NOW), 25, "nudge fallen due → +25");
  assert.equal(urgency(makePin({ status: "blocked" }), NOW), 20, "blocked rises → +20");
});

test("a done Pin has zero urgency even if overdue", () => {
  assert.equal(urgency(makePin({ status: "done", due: at(-30) }), NOW), 0);
});

test("urgency clamps to 100", () => {
  const everything = makePin({
    due: at(-100),
    last_touched: at(-100),
    nudge: at(-1),
    status: "blocked",
  });
  assert.equal(urgency(everything, NOW), 100);
});

test("isSnoozed only while the snooze date is in the future", () => {
  assert.equal(isSnoozed(makePin({ snooze: at(1) }), NOW), true);
  assert.equal(isSnoozed(makePin({ snooze: at(-1) }), NOW), false);
  assert.equal(isSnoozed(makePin({ snooze: null }), NOW), false);
});

test("prioritize: importance band wins, urgency orders within, snoozed disappear", () => {
  const criticalCalm = makePin({ id: "crit", importance: "critical" }); // urgency 0
  const lowOnFire = makePin({ id: "low", importance: "low", due: at(-5) }); // urgency 65
  const snoozed = makePin({ id: "snz", importance: "critical", snooze: at(2) });

  const result = prioritize([lowOnFire, snoozed, criticalCalm], NOW);

  assert.deepEqual(
    result.map((p) => p.id),
    ["crit", "low"],
    "critical band sits above low regardless of urgency; snoozed is gone",
  );
  assert.equal(result.find((p) => p.id === "low")?.urgency, 65);
});

test("prioritize: within one band, the overdue Pin floats above the fresh one", () => {
  const fresh = makePin({ id: "fresh" });
  const overdue = makePin({ id: "overdue", due: at(-3) });

  const result = prioritize([fresh, overdue], NOW);
  assert.deepEqual(result.map((p) => p.id), ["overdue", "fresh"]);
});

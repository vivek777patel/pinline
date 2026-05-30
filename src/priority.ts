import type { Importance, Pin } from "./pin.ts";

/** A Pin with its computed urgency attached. Urgency is never stored — it is derived here. */
export interface PrioritizedPin extends Pin {
  urgency: number;
}

const IMPORTANCE_RANK: Record<Importance, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const DAY = 86_400_000;

function days(ms: number): number {
  return ms / DAY;
}

/** A Pin is snoozed (hidden) while its snooze date is still in the future. */
export function isSnoozed(pin: Pin, now: Date): boolean {
  return pin.snooze != null && new Date(pin.snooze).getTime() > now.getTime();
}

/**
 * Compute a Pin's urgency (0–100) from its time fields and status.
 * Defaults per ADR-0001: overdue dominates, due-soon ramps over 3 days,
 * staleness nags after 7 days, a due nudge and a blocked status each add a boost.
 * A done Pin is not actionable, so its urgency is 0.
 */
export function urgency(pin: Pin, now: Date): number {
  if (pin.status === "done") return 0;
  const t = now.getTime();
  let score = 0;

  if (pin.due != null) {
    const due = new Date(pin.due).getTime();
    if (due < t) {
      score += 50 + Math.min(30, 3 * days(t - due)); // overdue: big, grows, capped
    } else {
      const until = days(due - t);
      if (until <= 3) score += (1 - until / 3) * 40; // due-soon ramp
    }
  }

  const stale = days(t - new Date(pin.last_touched).getTime());
  if (stale > 7) score += Math.min(30, (stale - 7) * 2); // slow nag, capped

  if (pin.nudge != null && new Date(pin.nudge).getTime() <= t) score += 25;

  if (pin.status === "blocked") score += 20; // blocked rises — it needs unblocking

  return Math.round(Math.min(100, score));
}

/** Importance band first; within a band, higher urgency, then sooner due, then older. */
export function comparePins(a: PrioritizedPin, b: PrioritizedPin): number {
  const band = IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance];
  if (band !== 0) return band;
  if (a.urgency !== b.urgency) return b.urgency - a.urgency;
  const aDue = a.due ? new Date(a.due).getTime() : Infinity;
  const bDue = b.due ? new Date(b.due).getTime() : Infinity;
  if (aDue !== bDue) return aDue - bDue;
  return new Date(a.created).getTime() - new Date(b.created).getTime();
}

/** Drop snoozed Pins, attach urgency, and sort by priority. */
export function prioritize(pins: Pin[], now: Date = new Date()): PrioritizedPin[] {
  return pins
    .filter((p) => !isSnoozed(p, now))
    .map((p) => ({ ...p, urgency: urgency(p, now) }))
    .sort(comparePins);
}

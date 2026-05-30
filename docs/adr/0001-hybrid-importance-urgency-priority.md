# Hybrid importance × urgency priority

**Status:** accepted

A Pin's effective **Priority** is not a single stored field. It is derived from two
inputs: **Importance** — a manual, static bucket (`Critical / High / Medium / Low`)
the user sets — and **Urgency** — a score recomputed automatically from the Pin's
time fields and status. Importance is the primary sort band; Urgency orders Pins
within a band and rises on its own as deadlines approach, items go stale, or a nudge
falls due. A Blocked Pin gains urgency (it needs unblocking); a Snoozed Pin is
suppressed from view until its snooze date.

## Why

The user's headline requirement is that high-priority work surfaces to the top *and
stays current without manual re-sorting*. Three options were weighed:

- **Manual priority** — rejected: it never updates itself, so a Pin marked "low" weeks
  ago stays buried after it goes overdue, directly contradicting the requirement.
- **Fully computed score** — rejected: removes the user's ability to say "this simply
  matters more than the formula thinks."
- **Hybrid (chosen)** — keeps a human thumb on the scale (Importance) while letting time
  drive movement (Urgency). This is the classic importance/urgency split.

## Consequences

- Two fields where a naive reader expects one "priority" — hence this record.
- A Finding's **Severity** sets the *default* Importance (Critical → Critical), overridable.
- Urgency must be (re)computed at read/sort time from `due`, `nudge`, `snooze`,
  `last touched`, and `status`. Default tuning (subject to change): overdue → large jump
  growing per day; due-soon ramp begins 3 days out; staleness nags after 7 days untouched;
  nudge-due adds a boost; blocked adds a flat boost; snoozed hides until the snooze date.
- The sort logic lives in one place (the Pin list); all views inherit it.

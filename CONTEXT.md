# Pinline

A single-user, local web app for tracking the things one person is responsible for — tasks, followups, and security findings — across projects, teams, and people, with high-priority items surfaced to the top of the list.

## Language

**Pin**:
The single core entity — one tracked item. Every Pin has a `type`, a priority, a position on the timeline, and a status. The four "views" are filters over Pins, not separate subsystems.
_Avoid_: Item, task (as a synonym for the whole), card, ticket, entry

**Pin type**:
The discriminator on a Pin. One of: **Task**, **Followup**, **Finding**. Type decides which optional, type-specific fields apply (e.g. a Followup's "waiting on", a Finding's severity).
_Avoid_: category, kind

**Task**:
A Pin type. A unit of work the user themselves must do.
_Avoid_: todo, action item

**Followup**:
A Pin type. Something the user is waiting on from someone else, and intends to chase. Adds the dimension of *who* is owed and *when to nudge*.
_Avoid_: reminder, ping, chase

**Finding**:
A Pin type. A security finding the user is tracking to resolution. Carries Finding-only fields: **Severity**, an **Asset** (the affected thing), a **Remediation state**, and an optional reference (URL/id).
_Avoid_: vuln, issue, bug, vulnerability

**Project**:
A container that Pins belong to. Not itself a Pin and not tracked directly. Used to slice Pins in the project-wise view.
_Avoid_: workstream, initiative, epic

**Team**:
A dimension tagged onto a Pin (the team the work relates to). Not a Pin. Powers the team-wise view.
_Avoid_: group, squad

**Person**:
A dimension tagged onto a Pin — a human the Pin references (e.g. the person a Followup is waiting on). Not a Pin, not a login (the app is single-user). Powers the team-member-wise view.
_Avoid_: User (reserved sense: there are no user accounts), assignee, owner, member

**Asset**:
A dimension tagged onto a Pin — the affected system/host/target (e.g. `api-gateway prod`, `acme.com`). Most relevant to Findings but available to any Pin. A first-class, filterable/groupable dimension alongside Project, Team, and Person.
_Avoid_: target, host, system, resource

**Severity**:
A Finding-only attribute: how bad the security issue is. Qualitative — `Critical / High / Medium / Low / Info`. Sets the default Importance for a Finding (overridable). Distinct from Priority and Importance, which are cross-cutting.
_Avoid_: priority, importance, criticality, CVSS

**Priority**:
The effective ordering of a Pin in the list, derived from two inputs: **Importance** (manual) and **Urgency** (computed). Not a field the user sets directly — it is the combination.
_Avoid_: severity (severity is Finding-specific, distinct from priority)

**Importance**:
The manual, user-set dimension of priority — how much a Pin fundamentally matters, independent of time. One of `Critical / High / Medium / Low`. Static until the user changes it. For a Finding, its severity sets the default Importance (overridable). It is the primary sort band.
_Avoid_: priority (priority is the combined result, not this input alone)

**Urgency**:
The computed, time-driven dimension of priority — a score that rises automatically as deadlines approach, items go stale, or a nudge falls due. Recomputed from a Pin's time fields and status; the user never sets it directly. Orders Pins within an Importance band. A Blocked Pin gains urgency (needs unblocking); a Snoozed Pin is suppressed from view.
_Avoid_: priority, staleness (staleness is one input to urgency)

**Timeline**:
The temporal aspect of a Pin — the dates/events that place it in time and feed ordering. A Pin carries up to six time fields: **created** and **last touched** (automatic, always present), and **due**, **nudge**, **snooze**, **closed** (optional).
_Avoid_: schedule, calendar

**Status**:
A Pin's position in its lifecycle. One shared lifecycle for all Pin types: **Open → In Progress → Blocked → Done**. A Pin is "live" until Done.
_Avoid_: state, stage

**Remediation state**:
A Finding-only field tracking the security-resolution stage: **Triaged → In Remediation → Remediated → Verified**, plus two terminal escape hatches **Accepted Risk** and **False Positive**. Separate from, and additional to, the shared Status — it does not replace it.
_Avoid_: status (reserved for the shared lifecycle)

**Nudge**:
A date on a Pin (typically a Followup) marking when to *resurface it to chase someone else*. Proactive: "chase Priya on Thursday." When the nudge date arrives, the Pin should surface.
_Avoid_: reminder, ping, followup-date

**Snooze**:
A date that *hides a Pin from the user's own list until then*. Deferral of one's own attention: "don't show me this until Monday." Distinct from Nudge — Nudge is about chasing another person; Snooze is about suppressing the Pin from view.
_Avoid_: defer, hide, mute

## Flagged ambiguities

- **Priority vs Severity**: "Severity" is a Finding-specific attribute (how bad the security issue is). "Priority" is the cross-cutting attribute that orders *all* Pins. They are not the same and may feed into each other rather than be equated.
- **Person vs User**: There are no user accounts (single-user app). "Person" never means "someone who logs in."

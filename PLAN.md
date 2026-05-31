# Pinline — Build Plan

A single-user, local web app for tracking tasks, followups, and security findings, with
high-priority work surfaced to the top. See [CONTEXT.md](./CONTEXT.md) for the domain
glossary and [docs/adr/](./docs/adr/) for the two load-bearing decisions.

## Locked design

| Decision | Resolution |
|---|---|
| Users | Single-user, local, no auth |
| Form factor | Local web app + fast quick-add |
| Core model | One `Pin` entity; type ∈ {Task, Followup, Finding} |
| Containers / dimensions | Project (container); Team / Person / Asset (dimensions) |
| Lifecycle | Shared `Open → In Progress → Blocked → Done`; Findings add a remediation state |
| Time | created, last-touched (auto) + due, nudge, snooze, closed (optional) |
| Priority | Hybrid: manual Importance × computed Urgency (ADR-0001) |
| Capture | Smart quick-add with sigils |
| Views | One list, group-by + filter; flat priority home; Done archived |
| Storage / stack | Node + TypeScript, SQLite file, tiny local server, React/Vite frontend (ADR-0002) |

## Data model (sketch)

**Pin**
- `id`, `title`, `description?` (free text, editor-only)
- `type`: `task | followup | finding`
- `importance`: `critical | high | medium | low`
- `status`: `open | in_progress | blocked | done`
- `project_id?` (container) — FK
- `created` (auto), `last_touched` (auto), `due?`, `nudge?`, `snooze?`, `closed?`
- Finding-only: `severity?` (`critical | high | medium | low | info`),
  `remediation_state?` (`triaged | in_remediation | remediated | verified | accepted_risk | false_positive`),
  `reference?` (url/text)

**Dimensions** (resolved in slice 5):
- `Project / Engagement / Initiative` — a container, **one per Pin**: `pins.project_id` FK.
- `Team`, `Person / Member`, `Asset / App / Service` — taggable, **many per Pin**: join tables
  (`pin_teams`, `pin_persons`, `pin_assets`) with `ON DELETE CASCADE`.
- Dimension rows are de-duplicated by name (find-or-create) and shared across Pins.

A Pin's effective `priority` is **derived at sort time** (Importance band, Urgency within),
never stored. See ADR-0001.

## Urgency signals (default tuning, see ADR-0001)

- `due` passed → large boost, +growing per day overdue
- within 3 days of `due` → boost ramps up
- `last_touched` > 7 days → slow-growing staleness boost
- `nudge` ≤ today → boost
- `status = blocked` → flat boost (rises)
- `snooze` in the future → suppressed (hidden) until it passes

## Quick-add grammar

One line; unrecognized tokens fall into the title (never blocks capture).

| Sigil | Field |
|---|---|
| `%type` | task / fu / followup / finding (default: task) |
| `@person` | Person |
| `#project` | Project |
| `~team` | Team |
| `=asset` | Asset |
| `!level` | Importance (`!crit !high !med !low`) |
| `sev:level` | Severity (`critical/high/med/low/info`); implies `%finding` and sets default Importance |
| `due:` `nudge:` `snooze:` | dates (`today fri tomorrow 3d 2w`, weekday names, ISO) |

Dimension names are auto-created on capture. The quick-add bar shows a **live autocomplete dropdown** as you type after a sigil — matching existing names appear so you can select instead of re-typing. Post-capture, all fields are editable in the Pin editor (see below), which also has autocomplete on every dimension field.

## Views

Delivered as a **sidebar menu** (collapsible) of named views, each a lens over the one
prioritized Pin list. Within every view, Pins sort by Importance band → Urgency.

- **All** — every live Pin, flat, priority-sorted (high on top).
- **Findings** — `type = finding`, with severity badge + remediation control per card.
- **Projects / Teams / Members / Assets** — grouped by that dimension (a Pin appears under
  each of its dimension values; the four "views" from the original ask).
- **Archive** — Done Pins (out of the live views).
- **Click any chip** to filter the current view to that project/team/person/asset.
- **Agenda strip** — a horizontal "next 7 days" track of upcoming `due` / `nudge` dates;
  each card opens the editor.

## Build order (tracer-bullet slices) — ✅ all complete

1. **Storage + Pin CRUD** — SQLite schema, local server, create/read/update a Pin. Verify: a Pin round-trips to the DB file.
2. **Priority sort** — compute Urgency, sort by Importance band + Urgency. Verify: overdue/stale Pins float up; snoozed disappear.
3. **Quick-add parser** — sigil grammar → Pin. Verify: the example line parses to the right fields; junk falls to title.
4. **Home view** — flat priority-sorted list with status changes. Verify: "high on top" holds live.
5. **Dimensions + group-by/filter** — Project/Team/Person/Asset, the lens controls. Verify: each of the four named views is reproducible from the controls.
6. **Finding fields** — severity → default importance, remediation state, asset. Verify: a Finding shows its extra columns under the finding filter.
7. **Done archive + (optional) agenda strip.**

## Delivered beyond the original plan

- **Menu-driven views + grid + futuristic theme** — the group-by/filter controls became a
  collapsible sidebar of named views (All / Findings / Projects/Engagements / Teams /
  Members / Assets/Apps/Services / Archive); the list became a responsive card grid; the
  look is a neon/glass "command center" (sidebar collapse state persists in `localStorage`).
- **Type colour coding** — two independent visual signals per card: **left border** = type
  (finding=magenta, task=violet, followup=green); **top bar** = importance (critical=red,
  high=amber, medium=cyan, low=gray). Both explained by a **colour legend strip** shown
  above the card grid, and a **due/nudge key** in the agenda header.
- **Pin editor** (`web/src/PinEditor.tsx`) — click a Pin title or an agenda card to open a
  modal that edits **every** field: title, description, type, importance, status, severity,
  remediation, `due`/`nudge`/`snooze` via date pickers, and project/teams/people/assets
  (comma-separated). Includes Delete. `updatePin` replaces dimension links on PATCH.
- **Description field** — free-text `description` column on Pin. Shown only in the editor
  (not on the card). DB back-fill migration auto-runs on server start.
- **Filter bar** (All view) — dropdowns for every field: type, importance, status, due
  (overdue/today/this week/no date), severity, remediation, project, team, person, asset.
  Dimension dropdowns populated from live data. Active filters glow cyan; clear-all pill.
- **Agenda summary bar** — redesigned into a horizontal scroll track of mini cards with a
  header, count pill, and due/nudge colour key. Each card clickable → opens the editor.
- **Browser e2e harness** — Playwright drives the built app end-to-end (`npm run e2e`).
- **Dimension autocomplete** — typing after a dimension sigil in the quick-add bar (or in any dimension field of the editor) shows a filtered dropdown of existing names. Prevents duplicate dimension entries from spelling variations. Implemented in `SuggestInput.tsx` (reusable component; single and multi/comma-separated modes). No backend changes — suggestion data comes from the already-loaded pins.
- **Card chip overflow** — cards with more than 3 dimension chips show the first 3 then a muted `+N more` pill that opens the editor. Keeps card heights uniform regardless of how many people/teams/assets a Pin has.
- **Thumbtack logo + favicon** — sidebar logo and browser-tab favicon use an SVG pushpin/thumbtack icon (`web/public/favicon.svg`), replacing the earlier map-marker shape.
- **DB query optimisation** — `listPins()` replaced the N+1 pattern (4N+1 queries for N pins) with a single `LEFT JOIN + GROUP_CONCAT` query. Also added `idx_pins_created` index and 8 MB `cache_size` pragma. See `docs/session-log.md` section 9.
- **`npm run dev`** — single command launching both `dev:api` and `dev:web` in parallel via `concurrently`. API output in cyan, Vite in magenta.
- **Bulk CSV import** (`web/src/ImportModal.tsx`) — ⬆ button next to quick-add opens an import modal. Client-side CSV parsing, fixed column schema, preview table with per-row validation (valid/invalid highlighted), skip-bad-rows error handling, `POST /api/pins/bulk` batch endpoint. Includes a **⬇ template CSV** download (header + 2 example rows).
- **CSV export** — ⬇ button exports the currently filtered/viewed pins as a CSV. Filename reflects the active view. All 15 schema columns included; multi-value dims pipe-joined. Export schema matches import schema for round-trip editing.

## Running it

- One process: `npm run build:web && npm start` → http://localhost:4000
- Dev (both servers): `npm run dev` → API on :4000 (cyan) + Vite on :5173 (magenta)
- Dev (backend auto-reload): `npm run dev:api` (serves the last `build:web` output)
- Dev (frontend hot-reload): `npm run dev:web` → http://localhost:5173 (proxies `/api`)

## Tests

- **Unit (backend):** `npm test` — 31 tests across storage, priority, quick-add, dimensions,
  finding fields, and editing.
- **Browser (e2e):** `npm run e2e` — 14 checks over the real UI (capture, views, chip-filter,
  editor incl. comma-separated dimensions, remediation, archive, collapsible sidebar).
- **Types:** `npm run typecheck` (API) and `npm run typecheck:web` (frontend).

> **Note:** the e2e suite was updated to account for the 3-chip overflow cap — the "chase vendor"
> quick-add no longer includes `@priya` so the editor's two teams + one asset stay within 3
> visible chips and the assertion holds.

## File map

```
src/            db.ts (schema/migrate) · pin.ts (model + CRUD) · priority.ts (urgency/sort)
                quickadd.ts (parser) · server.ts (REST + static) · index.ts (entry)
web/src/        App.tsx (shell + views) · PinEditor.tsx · ImportModal.tsx · SuggestInput.tsx · api.ts · styles.css
web/public/     favicon.svg (pushpin icon)
test/           *.test.ts (node:test) · e2e.mjs (Playwright)
docs/adr/       0001 priority model · 0002 SQLite-file storage
CONTEXT.md      domain glossary    PLAN.md  this file
```

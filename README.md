# 📌 Pinline

A single-user, local-first **command center** for tracking your tasks, followups, and
security findings — with high-priority work surfaced to the top automatically.

Everything is a **Pin**. You capture Pins from one fast command bar, the app keeps the
urgent ones on top, and you slice them by project, team, person, or asset through a
sidebar of named views.

- **No accounts, no cloud** — runs on `localhost`, all data in one portable `pinline.db` file.
- **Capture in one line** — `%finding =api-gw expired cert #infra ~platform sev:critical due:fri`
- **Self-sorting** — importance is yours to set; urgency rises on its own as deadlines and staleness build.

> Design rationale lives in [CONTEXT.md](./CONTEXT.md) (glossary), [PLAN.md](./PLAN.md)
> (blueprint), and [docs/adr/](./docs/adr/) (the two load-bearing decisions).

---

## Quick start

```bash
npm install
npm run build:web      # build the frontend
npm start              # serve everything on http://localhost:4000
```

Open **http://localhost:4000** and type into the quick-add bar.

### Development

| Command | What it does |
|---|---|
| `npm run dev:api` | API server with auto-reload on backend changes (serves the last `build:web`) |
| `npm run dev:web` | Vite dev server with hot-reload → http://localhost:5173 (proxies `/api` to :4000) |
| `npm run build:web` | Production build of the frontend into `web/dist` |
| `npm start` | Single process: API + the built frontend on :4000 |
| `npm test` | Backend unit tests (Node test runner) |
| `npm run e2e` | Browser end-to-end tests (Playwright) |
| `npm run typecheck` / `typecheck:web` | Type-check API / frontend |

Config: `PORT` (default `4000`) and `PINLINE_DB` (default `./pinline.db`).

---

## Concepts

A **Pin** is the one core entity. Every Pin has:

- a **type** — `task` (you do it), `followup` (you're waiting on someone), or `finding` (a security issue);
- an **importance** you set (`critical / high / medium / low`);
- a **status** — `open → in_progress → blocked → done`;
- optional **dates** — `due`, `nudge`, `snooze` (plus automatic `created`, `last_touched`, `closed`);
- optional **dimensions** — one **Project** (a container) and any number of **Teams**, **People**, and **Assets** (tags).

**Findings** also carry a **severity** (`critical…info`) and a **remediation state**
(`triaged → in_remediation → remediated → verified`, plus `accepted_risk` / `false_positive`).

**Dimensions explained:**
- **Project** — the work bucket a Pin belongs to (e.g. `infra`). One per Pin.
- **Team** — the team it relates to (e.g. `platform`).
- **Person** — a human it references (e.g. who a followup is waiting on).
- **Asset** — the affected system/host/target (e.g. `api-gw-prod`). The "what's affected" axis, mainly for findings.

---

## Priority: importance × urgency

A Pin's position is **not a single stored number** — it's derived from two parts (see [ADR-0001](./docs/adr/0001-hybrid-importance-urgency-priority.md)):

- **Importance** — manual, the primary sort band.
- **Urgency** — computed (0–100), recalculated from time + status each time the list loads:

| Signal | Effect |
|---|---|
| `due` passed (overdue) | big boost, +grows per day overdue |
| within 3 days of `due` | boost ramps as it approaches |
| `last_touched` > 7 days | slow "staleness" boost (makes deadline-less Pins resurface) |
| `nudge` ≤ today | boost (a followup becomes chase-worthy) |
| `status = blocked` | flat boost (it needs unblocking) |
| `snooze` in the future | **hidden** until the snooze date passes |
| `status = done` | urgency 0 |

Sort = importance band first, urgency within. A Finding's **severity sets its default
importance** (overridable).

---

## Quick-add grammar

One line. Unrecognized tokens fall into the **title**, so capture never blocks.

| Token | Sets |
|---|---|
| `%task` `%fu` `%finding` | type (default `task`) |
| `!high` `!crit` `!med` `!low` | importance |
| `sev:critical` … `sev:info` | severity (implies `%finding`, sets default importance) |
| `#project` | project |
| `~team` | team (repeatable) |
| `@person` | person (repeatable) |
| `=asset` | asset (repeatable) |
| `due:` `nudge:` `snooze:` | dates — `today`, `tomorrow`, `fri`, `3d`, `2w`, ISO |

Example:

```
%finding =api-gw-prod expired TLS cert #infra ~platform sev:critical due:fri @priya
```
→ a critical finding on `api-gw-prod`, project `infra`, team `platform`, waiting note for
`priya`, due Friday, title "expired TLS cert".

---

## Views (sidebar menu)

The sidebar is **collapsible** (state persists). Each item is a lens over the same
prioritized list:

- **All** — every live Pin, priority-sorted.
- **Findings** — only findings, with severity + remediation controls.
- **Projects / Teams / Members / Assets** — grouped by that dimension.
- **Archive** — Done Pins.

Click any **chip** on a card to filter to that value (e.g. `=api-gw-prod` → everything on
that host). The **next-7-days agenda** strip surfaces upcoming due/nudge dates.

## Editing

Click a Pin's **title** (or an **agenda card**) to open the editor. Every field is
editable — title, type, importance, status, severity, remediation, `due`/`nudge`/`snooze`
via date pickers, and project/teams/people/assets (comma-separated) — plus **Delete**.

---

## REST API

All under `/api`. Pins return their dimension **names** and a computed `urgency`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/pins` | Live + snooze-filtered, priority-sorted (`?all=true` for raw) |
| `POST` | `/api/pins` | Create from a JSON body |
| `POST` | `/api/pins/quick` | Create by parsing `{ "text": "<quick-add line>" }` |
| `GET` | `/api/pins/:id` | One Pin |
| `PATCH` | `/api/pins/:id` | Update any field (dimension arrays replace that dimension) |
| `DELETE` | `/api/pins/:id` | Delete (cascades dimension links) |

---

## Architecture

- **Backend** — Node + TypeScript, [`node:sqlite`](https://nodejs.org/api/sqlite.html)
  (built-in, no native deps), Express. One portable `pinline.db` file
  ([ADR-0002](./docs/adr/0002-sqlite-file-local-server.md)).
- **Frontend** — React + Vite (TypeScript), served as static assets by the same Express
  process in production.
- **Schema** — `pins` (+ `project_id` FK), dimension tables `projects/teams/persons/assets`,
  and join tables `pin_teams/pin_persons/pin_assets` (`ON DELETE CASCADE`). Dimension rows
  are de-duplicated by name and shared across Pins.

```
src/
  db.ts          open + migrate the SQLite database
  pin.ts         Pin types, CRUD, dimension resolution
  priority.ts    urgency() + sort (pure, never stored)
  quickadd.ts    the quick-add parser
  server.ts      REST routes + static frontend
  index.ts       entry point
web/src/
  App.tsx        app shell, sidebar views, card grid, agenda
  PinEditor.tsx  the edit modal
  api.ts         typed fetch helpers
  styles.css     the theme
test/
  *.test.ts      node:test unit tests
  e2e.mjs        Playwright browser tests
docs/adr/        0001 priority model · 0002 SQLite-file storage
```

## Testing

- **Unit:** `npm test` — 31 tests (storage round-trip, priority formula, quick-add parser,
  dimension persistence, finding fields, editing).
- **Browser:** `npm run e2e` — 14 checks driving the real built app (capture → views →
  chip-filter → editor incl. comma-separated dimensions → remediation → archive → collapse).

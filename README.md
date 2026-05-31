# 📌 Pinline

A single-user, local-first **command center** for tracking your tasks, followups, and
security findings — with high-priority work surfaced to the top automatically.

Everything is a **Pin**. You capture Pins from one fast command bar, the app keeps the
urgent ones on top, and you slice them by project, team, person, or asset through a
sidebar of named views.

- **No accounts, no cloud** — runs on `localhost`, all data in one portable `pinline.db` file.
- **Capture in one line** — `%finding =api-gw expired cert #infra ~platform sev:critical due:fri` with dimension autocomplete as you type
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
- an optional **description** — free text for context, notes, or steps to reproduce (visible in the editor only, not on the card);
- optional **dates** — `due`, `nudge`, `snooze` (plus automatic `created`, `last_touched`, `closed`);
- optional **dimensions** — one **Project / Engagement** (a container) and any number of **Teams**, **People / Members**, and **Assets / Apps / Services** (tags).

**Findings** also carry a **severity** (`critical…info`) and a **remediation state**
(`triaged → in_remediation → remediated → verified`, plus `accepted_risk` / `false_positive`).

**Dimensions explained:**

| Dimension | Answers | Example |
|---|---|---|
| **Project / Engagement / Initiative** | "What work bucket / engagement is this under?" | `pentest-q2`, `api-hardening`, `soc2` |
| **Team** | "Which team does this relate to?" | `platform`, `appsec` |
| **Person / Member** | "Who is involved or being chased?" | `priya`, `marcus` |
| **Asset / App / Service** | "What app, module, or service is affected?" | `api-gateway`, `auth-svc`, `payments-checkout` |

Project and Asset are the most commonly confused — a finding can be under engagement `pentest-q2` (project) while the affected system is `api-gateway` (asset). They answer different questions.

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

## Visual cues

Every card carries two independent colour signals:

| Signal | Location | Meaning |
|---|---|---|
| **Left border** | card left edge | **Type** — magenta = finding · violet = task · green = followup |
| **Top bar** | card top edge | **Importance** — red = critical · amber = high · cyan = medium · gray = low |

A **colour legend strip** above the grid explains both. The agenda header has a **due/nudge key** (amber = due date, green = nudge/chase).

## Views (sidebar menu)

The sidebar is **collapsible** (`«` / `»` button, state persists in localStorage). Each item is a lens over the same prioritized list:

- **All** — every live Pin, priority-sorted, with a full **filter bar** (type, importance, status, due, severity, remediation, project, team, person, asset). Active filters glow cyan; clear all with one click.
- **Findings** — only findings, severity badge + remediation dropdown per card.
- **Projects / Engagements** — grouped by project/engagement.
- **Teams** — grouped by team.
- **Members** — grouped by person/member.
- **Assets / Apps / Services** — grouped by asset/app/service. Shows everything affecting a given system.
- **Archive** — Done Pins, sorted newest-first.

Click any **chip** on a card to filter the current view to that value. Cards with more than 3 dimension chips show a **+N more** pill — click it to open the editor and see all. The **next-7-days agenda** strip surfaces upcoming due/nudge dates — click a card to open the editor.

## Editing

Click a Pin's **title** (or an **agenda card**) to open the editor. Every field is
editable — title, description, type, importance, status, severity, remediation,
`due`/`nudge`/`snooze` via date pickers, and project/teams/people/assets — plus **Delete**.

Dimension fields have **live autocomplete**: as you type, matching existing names appear in a dropdown (arrow keys or click to select, Escape to dismiss). New names are always accepted. This prevents accidental duplicates like `#infra` vs `#Infra`.

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
  App.tsx          app shell, sidebar views, card grid, agenda
  PinEditor.tsx    the edit modal
  SuggestInput.tsx reusable autocomplete input component
  api.ts           typed fetch helpers
  styles.css       the theme
test/
  *.test.ts      node:test unit tests
  e2e.mjs        Playwright browser tests
docs/adr/        0001 priority model · 0002 SQLite-file storage
```

## Testing

- **Unit:** `npm test` — 31 tests (storage round-trip, priority formula, quick-add parser,
  dimension persistence, finding fields, editing, description field).
- **Browser:** `npm run e2e` — 14 checks driving the real built app (capture → views →
  chip-filter → editor incl. comma-separated dimensions + description → remediation → archive → collapse).

> **After any frontend change:** run `npm run build:web` then hard-refresh the browser
> (`Cmd+Shift+R`) or open an incognito window — the browser caches the JS bundle aggressively.

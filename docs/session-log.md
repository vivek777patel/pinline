# Pinline — Session Log

Full record of the design + build session that produced this project.
Started: 2026-05-29. Continued: 2026-05-30.

---

## 1. Design grilling (pre-build decisions)

Every decision below was reached one question at a time before any code was written.

### Who is it for?
**Single-user, local, no auth.** "Team-wise" and "member-wise" views mean *your* view of
work involving those people — nobody else logs in. Kills auth, accounts, server-for-others,
and sync complexity in one call.

### Form factor
**Local web app** (localhost) with a fast quick-add bar. The center of gravity is *views*
(four slices, priority sorting, timelines), which the terminal does poorly. Capture speed
is solved by making the web input nearly as fast as a CLI, not by choosing CLI.

### Core model — one entity or four?
**One unified Pin with a `type` field.** Tasks, followups, and security findings share
~90% of fields (title, priority, timeline, status, dimensions). Separate entities would
mean four subsystems, four sort bugs, four archive views.

**Project is a container** (one per Pin, FK). **Team / Person / Asset are dimensions**
(many per Pin, join tables). The four "views" are filters/groupings over one table, not
separate stores.

### Lifecycle + dates
**One shared lifecycle:** `Open → In Progress → Blocked → Done`. Findings add a
*separate* **Remediation state** field (`triaged → in_remediation → remediated → verified`
+ `accepted_risk` / `false_positive`), not a different status system.

**Six time fields:**
- `created`, `last_touched` — automatic, always present.
- `due`, `nudge`, `snooze`, `closed` — optional, user-set.

**Nudge vs Snooze:**
- **Nudge** = "resurface this to chase someone else on this date." Proactive.
- **Snooze** = "hide this from my own list until this date." Deferral.

### Priority engine
**Hybrid: manual Importance × computed Urgency** (see ADR-0001).

- **Importance** — manual bucket (`critical / high / medium / low`). Primary sort band.
- **Urgency** — computed 0–100 from signals, recomputed at read time, never stored:

| Signal | Effect |
|---|---|
| Overdue (past `due`) | +50, grows +3/day overdue (capped at +80 total from this signal) |
| Due within 3 days | ramps up to +40 as it approaches |
| Stale (`last_touched` > 7d) | +2/day, capped at +30 |
| Nudge ≤ today | +25 |
| Status = blocked | +20 (rises — it needs unblocking) |
| Snoozed | hidden entirely until snooze passes |
| Status = done | urgency = 0 |

All signals cap at 100. Importance band is primary — a low-importance Pin can never
outrank a critical one regardless of urgency. Deliberate, per ADR-0001.

A Finding's **Severity** sets its default Importance (overridable): `critical→critical`,
`high→high`, `medium→medium`, `low→low`, `info→low`.

### Quick-add grammar
One line; unrecognized tokens fall into the title (capture never blocks):

| Token | Sets |
|---|---|
| `%task` `%fu` `%finding` (+ aliases) | type (default: task) |
| `!crit` `!high` `!med` `!low` | importance |
| `sev:critical` … `sev:info` | severity (implies `%finding`, sets default importance) |
| `#project` | project (first wins if multiple; warns) |
| `~team` | team (accumulates) |
| `@person` | person (accumulates) |
| `=asset` | asset (accumulates) |
| `due:` `nudge:` `snooze:` | dates: `today`, `tomorrow`, `fri`, `3d`, `2w`, ISO |

Sigil rationale: `@` = universal mention, `#` = file-under-bucket, `~` = the group
(avoids clash with `@`/`#`), `=` = on/equals this target, `sev:` = namespaced keyword
(avoids collision with `!` importance — severity and importance are related but distinct).

### Views
**One list, two controls: group-by + filter.** The four named views from the brief
(*security findings, project-wise, team-wise, team-member-wise*) are:
- `type = finding` — Findings view
- `group by project` — Project view
- `group by team` — Teams view
- `group by person` — Members view

Done Pins hidden by default (archive). 7-day agenda strip for upcoming due/nudge dates.

### Stack
**Node + TypeScript, `node:sqlite` (built-in, no native deps), Express, React + Vite.**
SQLite: one portable `pinline.db` file (back up, sync, query with `sqlite3` directly).
See ADR-0002. The `node:sqlite` choice (over `better-sqlite3`) was made because Node 26
ships it built-in — zero native build steps, same on-disk format, same sync API.

### Finding-specific fields
- **Severity** — qualitative (`critical/high/medium/low/info`), not CVSS numeric.
- **Asset** — filterable/groupable dimension (a first-class lens, not just free text).
- **Remediation state** — `triaged/in_remediation/remediated/verified/accepted_risk/false_positive`.
- **Reference** — optional URL/text (scanner link, advisory, CVE id).

---

## 2. Build — slice by slice

### Slice 1 — Storage + Pin CRUD ✅
- `src/db.ts` — opens + migrates the SQLite file (WAL mode, foreign keys on).
- `src/pin.ts` — Pin types + CRUD (`create/get/list/update/delete`).
- `src/server.ts` — Express REST routes (`GET/POST/PATCH/DELETE /api/pins`).
- `src/index.ts` — entry point.
- **Verify:** a Pin round-trips to the DB file across a fresh connection (proves it
  persisted to disk, not just memory).

### Slice 2 — Priority sort ✅
- `src/priority.ts` — pure module: `urgency(pin, now)`, `isSnoozed`, `comparePins`,
  `prioritize`. Urgency is **computed, never stored**.
- `GET /api/pins` now returns priority-sorted, snooze-filtered list. Each Pin carries
  a computed `urgency` field. `?all=true` returns the raw unfiltered list.
- **Verify:** overdue/stale Pins float up; snoozed disappear; importance band always wins.

### Slice 3 — Quick-add parser ✅
- `src/quickadd.ts` — pure parser: `parseQuickAdd(text, now)` → `ParsedQuickAdd`.
- `toCreateInput(parsed)` → `CreatePinInput` (maps parse result to `createPin`).
- `POST /api/pins/quick { text }` — parses + creates, returns `{ pin, parsed }`.
- Unrecognized tokens fall into the title. Unknown sigils fall into the title. Date
  tokens that don't parse warn and stay in the title. Nothing ever blocks capture.
- **Seam noted:** dimensions parsed and echoed but not yet persisted (slice 5 closes it).

### Slice 4 — Home view ✅
- `web/` — Vite + React + TypeScript frontend.
- `vite.config.ts` — dev proxy `/api → :4000`; build output to `web/dist`.
- `web/src/App.tsx` — quick-add form, priority-sorted card list, status dropdown.
- `web/src/api.ts` — typed fetch helpers.
- `src/server.ts` — serves `web/dist` when built; SPA fallback for client routes.
- **One process in production** — `npm start` serves both API and frontend on :4000.

### Slice 5 — Dimensions + views ✅
- **Schema:** `projects/teams/persons/assets` tables; `pins.project_id` FK; join tables
  `pin_teams/pin_persons/pin_assets` with `ON DELETE CASCADE`; foreign keys enforced.
- **Design resolved here:** Project = one-per-Pin (FK); Team/Person/Asset = many (join
  tables). Dimension rows de-duplicated by name (find-or-create), shared across Pins.
- **`updatePin`** persists dimensions (replacing join links when provided).
- **Slice-3 seam closed:** `toCreateInput` now passes parsed dimensions through to
  `createPin`.
- **Frontend:** sidebar menu (All / Findings / Projects / Teams / Members / Assets /
  Archive), responsive card grid, group-by sections, type filter, clickable chips.

### Slice 6 — Finding fields ✅
- `sev:` keyword token added to the parser (maps to Severity enum).
- `sev:` **implies `%finding`** when no `%type` is given.
- **Severity → default Importance** in `createPin` (overridable by explicit `!`).
- Frontend: severity badge per Finding card, remediation-state dropdown.
- `SEVERITY_IMPORTANCE` map: `info → low`, rest map 1:1.

### Slice 7 — Done archive + agenda strip ✅
- **Archive:** Done Pins hidden from live views; Archive sidebar view shows them (sorted
  newest-first by `closed`).
- **Agenda strip:** a horizontal scroll track of upcoming `due`/`nudge` dates within 7
  days, soonest first. Each card shows a day badge, kind tag (DUE/NUDGE), and title.

---

## 3. Post-plan delivery (features built after the 7 slices)

### Futuristic design + card grid
- Full dark theme redesign: neon/glass aesthetic, radial glows, CSS grid card layout,
  glow on importance bands, monospace labels, soft severity pills.
- **Before:** flat rows, plain controls. **After:** command-center look with a grid of
  cards, colored bands that glow (critical = red, high = amber, medium = cyan).

### Collapsible sidebar
- `«` / `»` toggle button — collapses to 68px icon-only rail, expands to 234px with
  labels.
- State persisted in `localStorage` under key `pinline.sidebar`.
- Menu item `title` attributes provide tooltips when collapsed.

### Pin editor modal
- **`web/src/PinEditor.tsx`** — click a Pin title or an agenda card to open.
- Edits: title, type, importance, status, severity, remediation, `due`/`nudge`/`snooze`
  (native date pickers), project, teams, people, assets (comma-separated), Delete.
- Backend extended: `UpdatePinInput` now includes `teams/persons/assets`; `updatePin`
  replaces dimension links when the patch provides those arrays (undefined = leave
  unchanged).
- **Delete** sends `DELETE /api/pins/:id` (cascades join rows, keeps dimension records).

### Agenda card redesign
- **Before:** a flat wrapping line of inline spans.
- **After:** a strip with a header row (`⌁ NEXT 7 DAYS` + count pill) and a horizontal
  scroll track of mini cards — day badge, kind tag, title (truncated).
- Each card is clickable → opens the Pin editor.

### Browser e2e harness
- `test/e2e.mjs` — Playwright drives the real built app (Chromium headless) against a
  temp DB. 14 checks covering: capture, views, chip-filter, editor (incl.
  comma-separated teams/assets), remediation, archive, collapsible sidebar.
- `npm run e2e` — spawns a fresh server, runs all checks, tears down.

---

## 3b. Further post-plan changes (2026-05-30 session)

### Description field
- Added a free-text `description` field to Pins — DB column (`ALTER TABLE` back-fill
  migration), model, API, and a resizable textarea in the editor modal.
- **Not shown on cards** — description is only visible when the editor is open (Vivek's
  explicit preference: keep cards clean).
- Saves as `null` when empty so no orphan empty element is rendered.

### Editor field labels clarified
Renamed labels in `PinEditor.tsx` to make the purpose of each dimension obvious:
- Project → **Project / Engagement / Initiative**
- People → **People / Members**
- Assets → **Assets / Apps / Services**

Same rename applied to the sidebar menu:
- Projects → **Projects / Engagements**
- Assets → **Assets / Apps / Services**

### Type-colour coding on cards
Two independent visual signals per card:
- **Top bar** = importance (critical red glow, high amber, medium cyan, low gray)
- **Left border** = type (finding = magenta, task = violet, followup = green)

Implemented via `.type-card-{type}` CSS classes on each `<li>` and a `.type-task` text
colour rule (the missing rule was the bug — task label was falling back to muted gray).

### Filter bar in the All view
A full filter bar appears only in the **All** view, below the quick-add input.
Filters available: **Type, Importance, Status, Due, Severity, Remediation, Project,
Team, Person, Asset**.

- Dimension dropdowns (Project/Team/Person/Asset) are populated dynamically from the
  actual live Pins — only values that exist appear as options.
- Active filters glow cyan; the **clear N filters** pill removes all at once.
- Due filter has four options: overdue / today / this week / no date.
- Filters reset automatically when switching to another view.
- Chip-clicks still work alongside the filter bar (they stack).

### GitHub push
Project pushed to a private GitHub repo: https://github.com/vivek777patel/pinline
via SSH (`git@github.com:vivek777patel/pinline.git`). `GH_TOKEN` in `~/.zshrc` is
still invalid — `gh` CLI commands fail, but `git push` over SSH works fine.

### Session memory saved
Seven memory files written to the Claude project memory store covering: user profile,
project state, domain model, architecture gotchas, quick-add grammar, workflow
preferences, and the GH_TOKEN situation.

---

## 4. Bugs found and fixed during the session

### Browser cache serving stale JS bundle
**Symptom:** UI changes (label renames, type colours) appeared correct in the built
bundle but Vivek still saw old text in the browser.

**Root cause:** browser aggressively caches the JS bundle filename. Even after
`npm run build:web` produces a new filename-hashed bundle, the browser serves the old
one from cache.

**Fix:** hard refresh (`Cmd+Shift+R`) or open in an incognito window. Confirmed by
`grep`-ing the new label text in the dist bundle to prove the server was serving the
right file — proving it was a client cache issue, not a server issue.

**Prevention:** always mention hard refresh / incognito after any frontend change.

### Missing `.type-task` CSS rule
**Symptom:** the `TASK` label on cards was muted gray, not violet — even though the
left border was correctly violet.

**Root cause:** `.type-finding` and `.type-followup` colour rules existed but
`.type-task` was never added, so it fell back to the base `.type` colour (muted gray).

**Fix:** added `.type-task { color: var(--violet); }` to `styles.css`.

### Stale server serving old `updatePin` code
**Symptom:** editing Teams/Assets/People in the modal appeared to save (no error) but
the values came back empty on reload. Project saved correctly.

**Root cause:** the long-running server on port 4000 had been launched before the
dimension-editing code was added to `updatePin`. Node doesn't hot-reload. Project already
worked in the old code; the new team/asset logic was dead in that process.

**Why tests didn't catch it:** unit tests and e2e each spawn a *fresh* server — they
never hit the stale one.

**Fix:** killed the stale process, restarted with `npm run dev:api` (Node `--watch` flag
— auto-restarts on backend file changes). Also strengthened the e2e to edit Teams +
Assets through the modal and assert the chips appear, so a regression will fail the suite.

---

## 5. Key technical choices (quick reference)

| Choice | Decision | Why |
|---|---|---|
| SQLite driver | `node:sqlite` (built-in) | Node 26 ships it; zero native deps |
| Urgency storage | computed at read time, never stored | avoids stale data; pure function is easy to test |
| Dimensions | find-or-create by name | de-dup rows; chips show names not UUIDs |
| Dimension update | replace join links when provided, leave unchanged if key absent | patch semantics — partial updates don't wipe unmentioned dims |
| Frontend grouping | in-memory on the client | single-user dataset is small; avoids query-param API complexity |
| Dev server | `npm run dev:api` (node --watch) | auto-restarts on backend changes; prevents stale-server class of bugs |
| `listPins()` query | single LEFT JOIN + GROUP_CONCAT | eliminates 4N+1 per-pin queries; see section 9 |

---

## 6. Files and commands

### File map
```
src/
  db.ts          open + migrate the SQLite database
  pin.ts         Pin types, CRUD, dimension resolution
  priority.ts    urgency() + prioritize() (pure, stateless)
  quickadd.ts    quick-add parser
  server.ts      REST routes + static frontend
  index.ts       entry point
web/src/
  App.tsx        app shell, sidebar menu, card grid, agenda
  PinEditor.tsx  edit modal
  api.ts         typed fetch helpers
  styles.css     futuristic dark theme
test/
  pin.test.ts          storage + CRUD
  priority.test.ts     urgency formula + sort
  quickadd.test.ts     parser grammar + HTTP endpoint
  dimensions.test.ts   dimension persistence + cascade
  finding.test.ts      sev: parser, severity→importance, remediation
  update.test.ts       editing scalars + dimensions + dates
  e2e.mjs              Playwright browser tests (14 checks)
docs/
  adr/0001-hybrid-importance-urgency-priority.md
  adr/0002-sqlite-file-local-server.md
  session-log.md       ← this file
CONTEXT.md             domain glossary
PLAN.md                build blueprint + file map + running instructions
README.md              front-door documentation
```

### Commands
```bash
npm run build:web          # build the React frontend
npm start                  # single process: API + frontend on :4000
npm run dev:api            # backend with auto-reload (node --watch)
npm run dev:web            # Vite dev server :5173 (proxies /api to :4000)
npm test                   # 31 unit tests
npm run e2e                # 14 Playwright browser tests
npm run typecheck          # API TypeScript check
npm run typecheck:web      # frontend TypeScript check
```

### Environment
```
PORT          default 4000
PINLINE_DB    default ./pinline.db
```

---

## 7. What's still open / natural next steps

- ~~**`npm run dev`**~~ ✅ done (section 10)
- ~~**Bulk CSV import / export**~~ ✅ done (section 10)
- **GitHub Actions** — a CI workflow running `npm test` + `npm run e2e` on push.
- **Editing dimensions as chips** — the editor currently uses comma-separated text
  fields with autocomplete; proper chip inputs with add/remove would be more polished.
- **Snooze-until date on agenda** — snoozed Pins are invisible; a "snoozed" section
  showing when they'll resurface could be useful.
- **Screenshots in README** — `docs/` folder with screenshots of the card grid,
  collapsed sidebar, editor, and agenda.
- **GH_TOKEN** — the `GH_TOKEN` env var in `~/.zshrc` holds an invalid token. Replace
  with a valid PAT (repo scope) or use `unset GH_TOKEN && gh auth login` to store
  credentials in the macOS Keychain instead of a dotfile.
- **Filter bar on Findings view** — currently only the All view has the full filter bar;
  severity/remediation filters would be useful in the Findings view.
- **e2e coverage for filter bar** — the Playwright suite doesn't yet cover the new
  filter bar interactions.

---

## 8. Post-plan session (2026-05-30 continued)

### Dimension autocomplete

Added live autocomplete to both the quick-add bar and the editor modal for all four
dimensions (project, team, person, asset).

**Quick-add bar:** as the user types after a dimension sigil (`#`, `~`, `@`, `=`), the
app detects the active token by scanning backwards from the cursor, looks up matching
existing names, and shows a dropdown below the input. Selecting a suggestion replaces
the token and adds a trailing space so the next token can follow immediately. Multiple
dimension tokens in one line each trigger their own suggestion cycle.

**Editor modal:** each dimension field is now a `SuggestInput` component. Project
(single value) suggests against the full field value. Teams/Persons/Assets
(comma-separated) suggest for the last comma-separated token, appending `", "` on
selection so the user can immediately type another value.

**Data source:** suggestion lists come from the already-loaded pins (no new API
endpoint). All pins are used (not just live), so archived project names are still
suggested. The existing `dimOptions` memo was split into `liveDimOptions` (for the
filter bar, live pins only) and `dimOptions` (for autocomplete, all pins).

**Key implementation detail:** Escape inside `SuggestInput` calls `stopPropagation()`
to prevent the editor's global Escape listener from closing the modal when the user
just wants to dismiss a suggestion dropdown.

New file: `web/src/SuggestInput.tsx` — reusable component with `single` and `multi`
(comma-separated) modes, keyboard navigation (ArrowUp/Down, Enter, Escape), and the
standard blur+mousedown timing trick to avoid race conditions.

### Card chip overflow

Cards with more than 3 dimension chips previously stretched tall, making the grid
uneven when a Pin had many people/teams/assets.

Fix: the first 3 chips across all dimensions are shown; any remainder is collapsed into
a muted `+N more` pill. Clicking the pill opens the editor where all dimensions are
visible. Card height is now uniform regardless of dimension count.

### Pushpin logo and favicon

Replaced the `◈` Unicode character (sidebar logo) and the earlier map-marker SVG
(which read as a location pin, not a task pin) with the Material Design `push_pin` icon
— a thumbtack/pushpin shape (flat head, tapered body, needle) that reads as "pinning
something to a board".

- `web/public/favicon.svg` — pushpin on a dark rounded-square background, used as
  the browser-tab favicon via `<link rel="icon">` in `index.html`.
- `web/src/App.tsx` — sidebar logo is the same SVG inline (22×22, cyan fill).

---

## 9. DB query optimization (2026-05-31)

### Problem: N+1 query pattern in `listPins()`

Every page load and every status/remediation change called `listPins()`, which ran
`SELECT * FROM pins` and then called `assemble()` for each row. `assemble()` fired 4
queries per pin:

- `SELECT name FROM projects WHERE id = ?` — project name lookup
- `SELECT d.name FROM pin_teams JOIN teams WHERE pin_id = ?` — team names
- `SELECT d.name FROM pin_persons JOIN persons WHERE pin_id = ?` — person names
- `SELECT d.name FROM pin_assets JOIN assets WHERE pin_id = ?` — asset names

At 100 pins: **401 queries per load**. At 500 pins: **2001 queries**. The pattern was
identified during a performance audit prompted by growing dimension usage.

### Fix: single LEFT JOIN + GROUP_CONCAT query

Replaced the N+1 loop with a single SQL query using `LEFT JOIN` across all four
dimension relationships and `GROUP_CONCAT(DISTINCT ...)` to aggregate names:

```sql
SELECT p.*, pr.name AS project_name,
  GROUP_CONCAT(DISTINCT t.name)  AS teams_csv,
  GROUP_CONCAT(DISTINCT pe.name) AS persons_csv,
  GROUP_CONCAT(DISTINCT a.name)  AS assets_csv
FROM pins p
LEFT JOIN projects pr ON pr.id = p.project_id
LEFT JOIN pin_teams pt ON pt.pin_id = p.id  LEFT JOIN teams t ON t.id = pt.team_id
LEFT JOIN pin_persons pp ON pp.pin_id = p.id  LEFT JOIN persons pe ON pe.id = pp.person_id
LEFT JOIN pin_assets pa ON pa.pin_id = p.id  LEFT JOIN assets a ON a.id = pa.asset_id
GROUP BY p.id ORDER BY p.created DESC
```

Result: comma-separated name strings are split (`.split(",").sort()`) in memory. The
`.sort()` is necessary because `GROUP_CONCAT(DISTINCT ...)` doesn't guarantee order,
and tests assert alphabetical dimension order.

Query count: **always 1** regardless of pin count.

`assemble()` is preserved unchanged — still used by `getPin()`, `createPin()`, and
`updatePin()` where single-pin 4-query cost is negligible.

### Additional tuning

- **`idx_pins_created` index** added in `migrate()` —`ORDER BY created DESC` in
  `listPins()` was doing a full scan; the index makes it a seek.
- **`PRAGMA cache_size = -8000`** set on DB open — 8 MB page cache, improves
  repeated reads from the WAL.

### Key implementation note

`PinListRow extends PinRow` was added as a local interface to type the JOIN query
result. `project_id` is destructured out (matching `assemble()`'s behaviour) and
`project_name` maps to `project: string | null` in the returned `Pin`.

All 31 unit tests pass unchanged, including `update.test.ts` which asserts sorted
dimension arrays (`["appsec", "secops"]`).

---

## 10. `npm run dev`, bulk import/export, e2e fix (2026-05-31 continued)

### `npm run dev` — single dev command

Added `concurrently` as a dev dependency. The new `npm run dev` script runs both
`dev:api` and `dev:web` in a single terminal, with API output prefixed and coloured
cyan, Vite output magenta. Removes the need to open two terminals during development.

Crossed off the open item from section 7.

### CSV bulk import

**Design (grilling session):** walked through every design branch before writing code:
- **Source:** tool export / spreadsheet (not hand-authored quick-add lines)
- **Format:** fixed column schema (not a dynamic mapping UI — simpler, matches Pin fields 1:1)
- **Parsing:** client-side in the browser (instant preview without server round-trip)
- **Multi-value separator:** `|` pipe within a CSV cell (avoids conflict with CSV commas)
- **Error handling:** skip bad rows, import the rest, report skipped rows with reason
- **Deduplication:** none — always create (predictable, no silent skips)
- **UI:** ⬆ button next to the quick-add bar → modal with preview before confirming

**Implementation:**

New file `web/src/ImportModal.tsx` — four states:
1. **idle** — schema hint, dropzone (click or drag-and-drop), template download button
2. **preview** — parsed rows table (valid rows normal, invalid rows red with reason), row count summary, "Import N pins" confirm button
3. **importing** — spinner / "Importing…"
4. **done** — "✓ N pins created" + any server-side skip list, Done button

Client-side CSV parser (~40 lines) handles quoted fields (RFC 4180 `""` escaping), CRLF and LF line endings, blank-row skipping, and whitespace trimming. No new npm dependency.

Row → `CreatePinInput` mapper:
- Header row required, column names case-insensitive
- Multi-value fields (`teams`, `persons`, `assets`) split on `|`
- `type` auto-set to `finding` when `severity` is provided and no explicit type
- All enum values validated; invalid rows flagged and skipped (not aborted)

New backend route: `POST /api/pins/bulk` in `src/server.ts`. Accepts `{ rows: CreatePinInput[] }`, loops `createPin()` per row with per-row error capture, returns `{ created: Pin[], errors: { row, message }[] }`. No new DB schema changes — `createPin()` already resolves dimensions on demand.

`web/src/api.ts` additions:
- `CreatePinInput` interface (mirrors `src/pin.ts`)
- `BulkImportResult` interface
- `bulkImport(rows)` fetch helper → `POST /api/pins/bulk`

### Import template download

Inside the import modal (idle state), a **⬇ template CSV** button downloads `pinline-template.csv` — the full 15-column header row plus two example rows (one finding, one task). Implemented as a `downloadTemplate()` function using `Blob` + `URL.createObjectURL` + ephemeral `<a>` click.

### CSV export

A **⬇ (green)** button added to the right of the ⬆ import button in the quick-add bar. Clicking it:
1. Takes the `filtered` pins already in component state (same set visible in the current view)
2. Serializes them to CSV using a `csvCell()` escape function (handles commas, quotes, newlines per RFC 4180)
3. Triggers a browser download via `Blob` + `URL.createObjectURL`
4. Names the file `pinline-{viewLabel}-export.csv` (e.g. `pinline-findings-export.csv`)

All 15 import columns are included in the export. Multi-value dims are `|`-joined. The export → edit → re-import round-trip works without field mismatch.

`reference` field added to the frontend `Pin` interface in `api.ts` — it was present in the API response from `assemble()` but missing from the TypeScript type.

### e2e test fix (chip overflow regression)

The e2e test at line 91 of `test/e2e.mjs` was asserting that `=db-prod` appeared as a
visible chip on the "chase vendor" card after an editor save. The test added two teams +
one asset, but "chase vendor" also started with `@priya` — four total dims, one over the
3-chip cap, so `=db-prod` landed in the `+1 more` overflow pill instead.

Fix: removed `@priya` from the "chase vendor" quick-add line. `@priya` was not asserted
anywhere downstream in the suite. After the edit the pin has exactly 3 chips
(~platform + ~secops + =db-prod), all visible. All 14 e2e checks pass.

# SQLite file behind a tiny local server

**Status:** accepted

Pinline runs as a small local server (Node + TypeScript) that persists all data to a
single portable SQLite file (`pinline.db`). The browser frontend talks to this local
server rather than storing data itself.

## Why

The app is single-user and fully local, which admits three shapes:

- **Pure browser app (IndexedDB), no server** — rejected: data is trapped in one browser
  profile. It can't be backed up easily, can't be `grep`'d or queried with `sqlite3`,
  can't be scripted against, and is lost if site data is cleared. For a security
  engineer, that data-portability loss is the dealbreaker.
- **Server + plain files (JSON/Markdown per Pin)** — rejected: human-readable, but sorting
  and filtering by a computed Urgency score means loading everything into memory on every
  read, fighting the grain of the core feature.
- **Server + SQLite file (chosen)** — one portable file the user owns: back it up, sync it
  via Dropbox/git, query it directly, script against it. Real SQL is exactly what the
  importance/urgency sort wants.

## Driver

We use Node's built-in `node:sqlite` (`DatabaseSync`) rather than a third-party driver
such as `better-sqlite3`. The target runtime is Node 26, which ships `node:sqlite`, so we
get the same on-disk SQLite file and synchronous API with zero native-build dependencies.
Swapping to `better-sqlite3` later would be mechanical (same SQL, same sync shape) if its
prebuilt binaries or extra features are ever needed.

## Consequences

- The user must run one local process to use the app (acceptable for a daily driver).
- Data lives in a single file that is trivial to back up and inspect outside the app.
- Switching persistence later (e.g. to a hosted DB) would be a meaningful rewrite — this
  choice is deliberately load-bearing, hence the record.

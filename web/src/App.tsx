import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  fetchPins,
  quickAdd,
  setRemediation,
  setStatus,
  REMEDIATION_STATES,
  STATUSES,
  type Importance,
  type Pin,
  type PinType,
  type RemediationState,
  type Severity,
  type Status,
} from "./api.ts";
import { PinEditor } from "./PinEditor.tsx";

type DimKind = "project" | "team" | "person" | "asset";
type View = "all" | "findings" | "project" | "team" | "person" | "asset" | "archive";

interface Filters {
  type: PinType | "";
  importance: Importance | "";
  status: Status | "";
  severity: Severity | "";
  remediation: RemediationState | "";
  due: "overdue" | "today" | "week" | "none" | "";
  project: string;
  team: string;
  person: string;
  asset: string;
}

const EMPTY_FILTERS: Filters = {
  type: "", importance: "", status: "", severity: "",
  remediation: "", due: "", project: "", team: "", person: "", asset: "",
};

const DIM_OF: Record<DimKind, (p: Pin) => string[]> = {
  project: (p) => (p.project ? [p.project] : []),
  team: (p) => p.teams,
  person: (p) => p.persons,
  asset: (p) => p.assets,
};

const DIM_SIGIL: Record<DimKind, string> = { project: "#", team: "~", person: "@", asset: "=" };

const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: "all", label: "All", icon: "◈" },
  { id: "findings", label: "Findings", icon: "⚠" },
  { id: "project", label: "Projects / Engagements", icon: "▤" },
  { id: "team", label: "Teams", icon: "⬡" },
  { id: "person", label: "Members", icon: "◐" },
  { id: "asset", label: "Assets / Apps / Services", icon: "⌬" },
  { id: "archive", label: "Archive", icon: "✓" },
];

const GROUPED: Record<string, DimKind | undefined> = {
  project: "project", team: "team", person: "person", asset: "asset",
};

function dueLabel(due: string): string {
  const days = Math.round((new Date(due).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days}d`;
}

function whenLabel(date: string): string {
  const days = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}

function agendaEntries(pins: Pin[]): { pin: Pin; date: string; kind: "due" | "nudge" }[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const endMs = startMs + 7 * 86_400_000;
  const out: { pin: Pin; date: string; kind: "due" | "nudge" }[] = [];
  for (const p of pins) {
    for (const kind of ["due", "nudge"] as const) {
      const v = p[kind];
      if (!v) continue;
      const ms = new Date(v).getTime();
      if (ms >= startMs && ms <= endMs) out.push({ pin: p, date: v, kind });
    }
  }
  return out.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function groupBy(pins: Pin[], by: DimKind): { key: string; pins: Pin[] }[] {
  const map = new Map<string, Pin[]>();
  for (const p of pins) {
    for (const k of DIM_OF[by](p).length ? DIM_OF[by](p) : ["—"]) {
      (map.get(k) ?? map.set(k, []).get(k)!).push(p);
    }
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === "—" ? 1 : b === "—" ? -1 : a.localeCompare(b)))
    .map(([key, gp]) => ({ key, pins: gp }));
}

function applyDueFilter(p: Pin, due: Filters["due"]): boolean {
  if (!due) return true;
  const now = Date.now();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const todayStart = start.getTime();
  const weekEnd = todayStart + 7 * 86_400_000;
  if (due === "none") return !p.due;
  if (!p.due) return false;
  const ms = new Date(p.due).getTime();
  if (due === "overdue") return ms < now;
  if (due === "today") return ms >= todayStart && ms < todayStart + 86_400_000;
  if (due === "week") return ms >= now && ms <= weekEnd;
  return true;
}

function unique(vals: string[]): string[] {
  return [...new Set(vals)].sort();
}

export default function App() {
  const [pins, setPins] = useState<Pin[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("all");
  const [dimFilter, setDimFilter] = useState<{ kind: DimKind; value: string } | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [editing, setEditing] = useState<Pin | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("pinline.sidebar") === "collapsed"; }
    catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem("pinline.sidebar", collapsed ? "collapsed" : "open"); }
    catch { /* ignore */ }
  }, [collapsed]);

  async function load() {
    try { setPins(await fetchPins()); setError(null); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void load(); }, []);

  const liveCount = pins.filter((p) => p.status !== "done").length;
  const findingCount = pins.filter((p) => p.status !== "done" && p.type === "finding").length;
  const isArchive = view === "archive";
  const isAll = view === "all";

  // Unique dimension values for filter dropdowns (from all live pins)
  const livePins = useMemo(() => pins.filter((p) => p.status !== "done"), [pins]);
  const dimOptions = useMemo(() => ({
    projects: unique(livePins.flatMap((p) => p.project ? [p.project] : [])),
    teams: unique(livePins.flatMap((p) => p.teams)),
    persons: unique(livePins.flatMap((p) => p.persons)),
    assets: unique(livePins.flatMap((p) => p.assets)),
  }), [livePins]);

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter(Boolean).length + (dimFilter ? 1 : 0),
    [filters, dimFilter],
  );

  function setFilter<K extends keyof Filters>(key: K, val: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: val }));
  }

  function clearAll() {
    setFilters(EMPTY_FILTERS);
    setDimFilter(null);
  }

  const filtered = useMemo(() => {
    let rows = pins.filter((p) => (isArchive ? p.status === "done" : p.status !== "done"));
    if (view === "findings") rows = rows.filter((p) => p.type === "finding");
    if (dimFilter) rows = rows.filter((p) => DIM_OF[dimFilter.kind](p).includes(dimFilter.value));

    if (isAll) {
      if (filters.type) rows = rows.filter((p) => p.type === filters.type);
      if (filters.importance) rows = rows.filter((p) => p.importance === filters.importance);
      if (filters.status) rows = rows.filter((p) => p.status === filters.status);
      if (filters.severity) rows = rows.filter((p) => p.severity === filters.severity);
      if (filters.remediation) rows = rows.filter((p) => p.remediation_state === filters.remediation);
      if (filters.due) rows = rows.filter((p) => applyDueFilter(p, filters.due));
      if (filters.project) rows = rows.filter((p) => p.project === filters.project);
      if (filters.team) rows = rows.filter((p) => p.teams.includes(filters.team));
      if (filters.person) rows = rows.filter((p) => p.persons.includes(filters.person));
      if (filters.asset) rows = rows.filter((p) => p.assets.includes(filters.asset));
    }

    if (isArchive) rows = [...rows].sort((a, b) => (b.closed ?? "").localeCompare(a.closed ?? ""));
    return rows;
  }, [pins, view, dimFilter, filters, isArchive, isAll]);

  const groupKind = GROUPED[view];
  const sections = useMemo(
    () => (groupKind ? groupBy(filtered, groupKind) : [{ key: "", pins: filtered }]),
    [filtered, groupKind],
  );
  const agenda = useMemo(() => (isArchive ? [] : agendaEntries(filtered)), [filtered, isArchive]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    try { await quickAdd(t); setText(""); await load(); }
    catch (e) { setError((e as Error).message); }
  }

  async function changeStatus(id: string, status: Status) {
    try { await setStatus(id, status); await load(); }
    catch (e) { setError((e as Error).message); }
  }

  async function changeRemediation(id: string, value: RemediationState | null) {
    try { await setRemediation(id, value); await load(); }
    catch (e) { setError((e as Error).message); }
  }

  function chip(kind: DimKind, value: string) {
    return (
      <button
        key={`${kind}:${value}`}
        type="button"
        className={`chip chip-${kind}`}
        onClick={() => setDimFilter({ kind, value })}
        title={`filter by ${kind}`}
      >
        {DIM_SIGIL[kind]}{value}
      </button>
    );
  }

  function renderPin(p: Pin): ReactNode {
    return (
      <li key={p.id} className={`pin imp-${p.importance} type-card-${p.type}${p.status === "done" ? " done" : ""}`}>
        <span className="band" aria-hidden />
        <div className="body">
          <button type="button" className="title" onClick={() => setEditing(p)} title="Edit pin">
            {p.title}
          </button>
          <span className="meta">
            <span className={`type type-${p.type}`}>{p.type}</span>
            {p.type === "finding" && p.severity && (
              <span className={`sev sev-${p.severity}`}>{p.severity}</span>
            )}
            {p.due && (
              <span className={dueLabel(p.due).includes("overdue") ? "due overdue" : "due"}>
                {dueLabel(p.due)}
              </span>
            )}
            {typeof p.urgency === "number" && p.urgency > 0 && <span className="urg">⚡{p.urgency}</span>}
            {p.type === "finding" && (
              <select
                className="remediation"
                aria-label="remediation state"
                value={p.remediation_state ?? ""}
                onChange={(e) => changeRemediation(p.id, (e.target.value || null) as RemediationState | null)}
              >
                <option value="">remediation…</option>
                {REMEDIATION_STATES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            )}
          </span>
          {(p.project !== null || p.teams.length > 0 || p.persons.length > 0 || p.assets.length > 0) && (
            <span className="chips">
              {p.project && chip("project", p.project)}
              {p.teams.map((t) => chip("team", t))}
              {p.persons.map((t) => chip("person", t))}
              {p.assets.map((t) => chip("asset", t))}
            </span>
          )}
        </div>
        <div className="foot">
          <select
            value={p.status}
            aria-label="status"
            onChange={(e) => changeStatus(p.id, e.target.value as Status)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
        </div>
      </li>
    );
  }

  const viewLabel = VIEWS.find((v) => v.id === view)?.label ?? "All";

  function fsel(key: keyof Filters, label: string, opts: string[], extra?: string) {
    const val = filters[key];
    return (
      <label key={key} className="fbar-item">
        <span className="fbar-label">{label}</span>
        <select
          value={val}
          className={val ? "fbar-sel active" : "fbar-sel"}
          onChange={(e) => setFilter(key, e.target.value as Filters[typeof key])}
        >
          <option value="">All</option>
          {opts.map((o) => <option key={o} value={o}>{extra ? o : o.replace(/_/g, " ")}</option>)}
        </select>
      </label>
    );
  }

  return (
    <div className="app">
      <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
        <button
          type="button"
          className="collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "»" : "«"}
        </button>
        <div className="brand">
          <span className="logo" aria-hidden>◈</span>
          <div className="brand-text">
            <h1>PINLINE</h1>
            <p className="tagline">command center</p>
          </div>
        </div>
        <nav className="menu">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`menu-item${view === v.id ? " active" : ""}`}
              title={v.label}
              onClick={() => { setView(v.id); setDimFilter(null); setFilters(EMPTY_FILTERS); }}
            >
              <span className="menu-icon" aria-hidden>{v.icon}</span>
              <span className="menu-label">{v.label}</span>
              {v.id === "findings" && findingCount > 0 && <span className="badge">{findingCount}</span>}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <span className="dot" />
          <span className="foot-text">{liveCount} live · {findingCount} findings</span>
        </div>
      </aside>

      <main className="content">
        <div className="content-head">
          <h2 className="view-title">{viewLabel}</h2>
          <span className="count-pill">{filtered.length}</span>
          {dimFilter && (
            <button type="button" className="chip filter-active" onClick={() => setDimFilter(null)}>
              {DIM_SIGIL[dimFilter.kind]}{dimFilter.value} ✕
            </button>
          )}
          {activeFilterCount > 0 && (
            <button type="button" className="clear-filters" onClick={clearAll}>
              clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} ✕
            </button>
          )}
        </div>

        <form onSubmit={submit} className="quickadd">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="quick add…  %finding =asset #project ~team @person !high due:fri"
          />
          <button type="submit">Pin it</button>
        </form>

        {/* Filter bar — All view only */}
        {isAll && (
          <div className="fbar">
            {fsel("type", "Type", ["task", "followup", "finding"])}
            {fsel("importance", "Importance", ["critical", "high", "medium", "low"])}
            {fsel("status", "Status", ["open", "in_progress", "blocked", "done"])}
            {fsel("due", "Due", ["overdue", "today", "week", "none"])}
            {fsel("severity", "Severity", ["critical", "high", "medium", "low", "info"])}
            {fsel("remediation", "Remediation", REMEDIATION_STATES)}
            {dimOptions.projects.length > 0 && fsel("project", "Project", dimOptions.projects)}
            {dimOptions.teams.length > 0 && fsel("team", "Team", dimOptions.teams)}
            {dimOptions.persons.length > 0 && fsel("person", "Person", dimOptions.persons)}
            {dimOptions.assets.length > 0 && fsel("asset", "Asset", dimOptions.assets)}
          </div>
        )}

        {agenda.length > 0 && (
          <div className="agenda">
            <div className="agenda-head">
              <span className="agenda-title">next 7 days</span>
              <span className="agenda-count">{agenda.length}</span>
            </div>
            <div className="agenda-track">
              {agenda.map((a, i) => (
                <button
                  type="button"
                  key={`${a.pin.id}-${a.kind}-${i}`}
                  className={`agenda-item ${a.kind}`}
                  onClick={() => setEditing(a.pin)}
                  title="Edit pin"
                >
                  <span className="when">{whenLabel(a.date)}</span>
                  <span className="agenda-meta">
                    <span className="agenda-kind">{a.kind}</span>
                    <span className="agenda-name">{a.pin.title}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        {filtered.length === 0 ? (
          <p className="empty">{isArchive ? "Archive is empty." : "Nothing matches."}</p>
        ) : (
          sections.map((s) => (
            <section key={s.key || "all"}>
              {groupKind && (
                <h3 className="group-head">
                  <span className="group-kind">{groupKind}</span> {s.key}
                  <span className="count">{s.pins.length}</span>
                </h3>
              )}
              <ul className="grid">{s.pins.map(renderPin)}</ul>
            </section>
          ))
        )}
      </main>

      {editing && (
        <PinEditor
          pin={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

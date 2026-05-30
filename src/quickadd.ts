import type { CreatePinInput, Importance, PinType, Severity } from "./pin.ts";

/** The full structured result of parsing one quick-add line. */
export interface ParsedQuickAdd {
  title: string;
  type: PinType;
  importance?: Importance;
  due: string | null;
  nudge: string | null;
  snooze: string | null;
  severity?: Severity; // Finding-only
  project: string | null; // a Pin belongs to at most one project (container)
  teams: string[];
  persons: string[];
  assets: string[];
  warnings: string[];
}

const TYPE_ALIASES: Record<string, PinType> = {
  task: "task", t: "task", todo: "task",
  fu: "followup", followup: "followup",
  finding: "finding", vuln: "finding", sec: "finding",
};

const IMPORTANCE_ALIASES: Record<string, Importance> = {
  crit: "critical", critical: "critical", c: "critical",
  high: "high", hi: "high", h: "high",
  med: "medium", medium: "medium", m: "medium",
  low: "low", lo: "low", l: "low",
};

const SEVERITY_ALIASES: Record<string, Severity> = {
  crit: "critical", critical: "critical", c: "critical",
  high: "high", hi: "high", h: "high",
  med: "medium", medium: "medium", m: "medium",
  low: "low", lo: "low", l: "low",
  info: "info", i: "info",
};

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY = 86_400_000;

function offsetIso(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY).toISOString();
}

/**
 * Resolve a date token to an ISO string, or null if unrecognised.
 * Supports: today / tomorrow / yesterday, `Nd` / `Nw`, weekday names
 * (next occurrence), and anything Date can parse (e.g. ISO 8601).
 * Relative tokens keep `now`'s time-of-day; results are UTC.
 */
export function parseDate(value: string, now: Date): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;

  const relative: Record<string, number> = { today: 0, tomorrow: 1, tmr: 1, yesterday: -1 };
  if (v in relative) return offsetIso(now, relative[v]);

  const span = v.match(/^\+?(\d+)([dw])$/);
  if (span) return offsetIso(now, span[2] === "w" ? Number(span[1]) * 7 : Number(span[1]));

  const dow = WEEKDAYS.findIndex((d) => d === v || d === v.slice(0, 3));
  if (dow >= 0) {
    const ahead = ((dow - now.getUTCDay() + 7) % 7) || 7; // next such weekday (never today)
    return offsetIso(now, ahead);
  }

  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Parse one quick-add line into a fully structured ParsedQuickAdd. Pure. */
export function parseQuickAdd(input: string, now: Date = new Date()): ParsedQuickAdd {
  const out: ParsedQuickAdd = {
    title: "", type: "task", due: null, nudge: null, snooze: null,
    project: null, teams: [], persons: [], assets: [], warnings: [],
  };
  const titleWords: string[] = [];
  let typeSet = false;

  for (const tok of input.trim().split(/\s+/).filter(Boolean)) {
    const date = tok.match(/^(due|nudge|snooze):(.*)$/i);
    if (date) {
      const field = date[1].toLowerCase() as "due" | "nudge" | "snooze";
      const parsed = parseDate(date[2], now);
      if (parsed) out[field] = parsed;
      else { out.warnings.push(`couldn't parse date "${date[2]}" for ${field}:`); titleWords.push(tok); }
      continue;
    }

    const sev = tok.match(/^sev(?:erity)?:(.*)$/i);
    if (sev) {
      const s = SEVERITY_ALIASES[sev[1].toLowerCase()];
      if (s) out.severity = s;
      else { out.warnings.push(`unknown severity "${sev[1]}"`); titleWords.push(tok); }
      continue;
    }

    const sigil = tok[0];
    const rest = tok.slice(1);
    if (!rest) { titleWords.push(tok); continue; } // bare sigil → just text

    switch (sigil) {
      case "%": {
        const t = TYPE_ALIASES[rest.toLowerCase()];
        if (t) { out.type = t; typeSet = true; }
        else { out.warnings.push(`unknown type "%${rest}"`); titleWords.push(tok); }
        break;
      }
      case "!": {
        const imp = IMPORTANCE_ALIASES[rest.toLowerCase()];
        if (imp) out.importance = imp;
        else { out.warnings.push(`unknown importance "!${rest}"`); titleWords.push(tok); }
        break;
      }
      case "@": out.persons.push(rest); break;
      case "~": out.teams.push(rest); break;
      case "=": out.assets.push(rest); break;
      case "#":
        if (out.project === null) out.project = rest;
        else out.warnings.push(`multiple projects; kept "#${out.project}", ignored "#${rest}"`);
        break;
      default: titleWords.push(tok);
    }
  }

  // Severity is a Finding concept: an unqualified `sev:` implies %finding.
  if (out.severity && !typeSet) out.type = "finding";

  out.title = titleWords.join(" ").trim();
  return out;
}

/** Map a parse to createPin input, including the dimensions it extracted. */
export function toCreateInput(p: ParsedQuickAdd): CreatePinInput {
  return {
    title: p.title,
    type: p.type,
    importance: p.importance,
    due: p.due,
    nudge: p.nudge,
    snooze: p.snooze,
    severity: p.severity,
    project: p.project ?? undefined,
    teams: p.teams,
    persons: p.persons,
    assets: p.assets,
  };
}

import { useEffect, useState, type FormEvent } from "react";
import {
  deletePin,
  updatePin,
  REMEDIATION_STATES,
  STATUSES,
  type Importance,
  type Pin,
  type PinType,
  type Severity,
  type Status,
} from "./api.ts";

const TYPES: PinType[] = ["task", "followup", "finding"];
const IMPORTANCES: Importance[] = ["critical", "high", "medium", "low"];
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

const toDate = (iso: string | null): string => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
const fromDate = (d: string): string | null => (d ? new Date(d).toISOString() : null);
const csv = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);

export function PinEditor({ pin, onClose, onSaved }: { pin: Pin; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(pin.title);
  const [description, setDescription] = useState(pin.description ?? "");
  const [type, setType] = useState<PinType>(pin.type);
  const [importance, setImportance] = useState<Importance>(pin.importance);
  const [status, setStatus] = useState<Status>(pin.status);
  const [severity, setSeverity] = useState(pin.severity ?? "");
  const [remediation, setRemediation] = useState(pin.remediation_state ?? "");
  const [due, setDue] = useState(toDate(pin.due));
  const [nudge, setNudge] = useState(toDate(pin.nudge));
  const [snooze, setSnooze] = useState(toDate(pin.snooze));
  const [project, setProject] = useState(pin.project ?? "");
  const [teams, setTeams] = useState(pin.teams.join(", "));
  const [persons, setPersons] = useState(pin.persons.join(", "));
  const [assets, setAssets] = useState(pin.assets.join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await updatePin(pin.id, {
        title: title.trim(),
        type,
        importance,
        status,
        severity: severity || null,
        remediation_state: remediation || null,
        description: description.trim() || null,
        due: fromDate(due),
        nudge: fromDate(nudge),
        snooze: fromDate(snooze),
        project: project.trim() || null,
        teams: csv(teams),
        persons: csv(persons),
        assets: csv(assets),
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this pin?")) return;
    setBusy(true);
    try {
      await deletePin(pin.id);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="modal-head">
          <h3>Edit pin</h3>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Additional context, notes, steps to reproduce, links…"
            rows={3}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as PinType)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Importance</span>
            <select value={importance} onChange={(e) => setImportance(e.target.value as Importance)}>
              {IMPORTANCES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>

        {type === "finding" && (
          <div className="field-row">
            <label className="field">
              <span>Severity</span>
              <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="">—</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Remediation</span>
              <select value={remediation} onChange={(e) => setRemediation(e.target.value)}>
                <option value="">—</option>
                {REMEDIATION_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="field-row">
          <label className="field">
            <span>Due</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="field">
            <span>Nudge</span>
            <input type="date" value={nudge} onChange={(e) => setNudge(e.target.value)} />
          </label>
          <label className="field">
            <span>Snooze</span>
            <input type="date" value={snooze} onChange={(e) => setSnooze(e.target.value)} />
          </label>
        </div>

        <label className="field">
          <span>Project / Engagement / Initiative</span>
          <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="one project or engagement" />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Teams</span>
            <input value={teams} onChange={(e) => setTeams(e.target.value)} placeholder="platform, secops" />
          </label>
          <label className="field">
            <span>People / Members</span>
            <input value={persons} onChange={(e) => setPersons(e.target.value)} placeholder="priya, marcus" />
          </label>
          <label className="field">
            <span>Assets / Apps / Services</span>
            <input value={assets} onChange={(e) => setAssets(e.target.value)} placeholder="comma, separated" />
          </label>
        </div>

        {err && <p className="error">{err}</p>}

        <div className="modal-actions">
          <button type="button" className="danger" onClick={remove} disabled={busy}>
            Delete
          </button>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

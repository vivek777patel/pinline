import { useRef, useState } from "react";
import { bulkImport, type BulkImportResult, type CreatePinInput, type Importance, type PinType, type RemediationState, type Severity, type Status } from "./api.ts";

type ModalState = "idle" | "preview" | "importing" | "done";

interface ParsedRow {
  idx: number;
  input: CreatePinInput | null;
  error: string | null;
}

const VALID_TYPES = new Set<string>(["task", "followup", "finding"]);
const VALID_IMPORTANCE = new Set<string>(["critical", "high", "medium", "low"]);
const VALID_STATUS = new Set<string>(["open", "in_progress", "blocked", "done"]);
const VALID_SEVERITY = new Set<string>(["critical", "high", "medium", "low", "info"]);
const VALID_REMEDIATION = new Set<string>([
  "triaged", "in_remediation", "remediated", "verified", "accepted_risk", "false_positive",
]);

function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim()); field = "";
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim()); field = "";
      if (row.some(Boolean)) lines.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) lines.push(row);
  return lines;
}

function mapRow(headers: string[], values: string[], idx: number): ParsedRow {
  const get = (col: string): string => (values[headers.indexOf(col)] ?? "").trim();
  const split = (col: string): string[] => {
    const v = get(col);
    return v ? v.split("|").map((s) => s.trim()).filter(Boolean) : [];
  };

  const title = get("title");
  if (!title) return { idx, input: null, error: "missing title" };

  const errors: string[] = [];

  const rawType = get("type");
  const rawSeverity = get("severity");
  const severity = rawSeverity && VALID_SEVERITY.has(rawSeverity) ? rawSeverity : rawSeverity ? null : "";
  if (rawSeverity && !VALID_SEVERITY.has(rawSeverity)) errors.push(`invalid severity "${rawSeverity}"`);

  const type = rawType || (rawSeverity && VALID_SEVERITY.has(rawSeverity) ? "finding" : "task");
  if (!VALID_TYPES.has(type)) errors.push(`invalid type "${rawType}"`);

  const rawImportance = get("importance");
  if (rawImportance && !VALID_IMPORTANCE.has(rawImportance)) errors.push(`invalid importance "${rawImportance}"`);

  const rawStatus = get("status");
  const status = rawStatus || "open";
  if (!VALID_STATUS.has(status)) errors.push(`invalid status "${rawStatus}"`);

  const rawRemediation = get("remediation_state");
  if (rawRemediation && !VALID_REMEDIATION.has(rawRemediation))
    errors.push(`invalid remediation_state "${rawRemediation}"`);

  if (errors.length) return { idx, input: null, error: errors.join("; ") };

  const input: CreatePinInput = {
    title,
    type: type as PinType,
    ...(rawImportance && { importance: rawImportance as Importance }),
    status: status as Status,
    ...(get("description") && { description: get("description") }),
    ...(get("due") && { due: get("due") }),
    ...(get("nudge") && { nudge: get("nudge") }),
    ...(get("snooze") && { snooze: get("snooze") }),
    ...(severity && { severity: severity as Severity }),
    ...(rawRemediation && { remediation_state: rawRemediation as RemediationState }),
    ...(get("reference") && { reference: get("reference") }),
    ...(get("project") && { project: get("project") }),
    teams: split("teams"),
    persons: split("persons"),
    assets: split("assets"),
  };

  return { idx, input, error: null };
}

const TEMPLATE_CSV = [
  "title,type,importance,status,description,due,nudge,snooze,severity,remediation_state,reference,project,teams,persons,assets",
  "XSS in login form,finding,high,open,Reflected XSS via q= parameter,2026-06-30,2026-06-15,,high,triaged,CVE-2024-1234,pentest-q2,red|appsec,alice,auth-svc|web-app",
  "Deploy security headers,task,medium,open,Add HSTS and CSP headers,,,,,,,,platform,,bob,",
].join("\r\n");

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pinline-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function parseFile(text: string): ParsedRow[] | string {
  const lines = parseCSV(text);
  if (lines.length < 2) return "CSV must have a header row and at least one data row.";
  const headers = lines[0].map((h) => h.toLowerCase());
  if (!headers.includes("title")) return 'CSV must have a "title" column.';
  return lines.slice(1).map((values, i) => mapRow(headers, values, i + 2));
}

interface Props {
  onClose: () => void;
  onImported: () => void;
}

export function ImportModal({ onClose, onImported }: Props) {
  const [state, setState] = useState<ModalState>("idle");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseFile(text);
      if (typeof parsed === "string") {
        setParseError(parsed);
        setRows([]);
      } else {
        setParseError(null);
        setRows(parsed);
        setState("preview");
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    const valid = rows.filter((r) => r.input !== null).map((r) => r.input!);
    setState("importing");
    try {
      const res = await bulkImport(valid);
      setResult(res);
      setState("done");
      if (res.created.length > 0) onImported();
    } catch (e) {
      setParseError((e as Error).message);
      setState("preview");
    }
  }

  const validCount = rows.filter((r) => !r.error).length;
  const invalidCount = rows.filter((r) => r.error).length;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal-wide">
        <div className="modal-head">
          <h3>Import CSV</h3>
          <button type="button" className="x" onClick={onClose}>✕</button>
        </div>

        {state === "idle" && (
          <>
            <p className="import-hint">
              Upload a CSV file with a header row. Required column: <code>title</code>.
              Optional: <code>type, importance, status, description, due, nudge, snooze,
              severity, remediation_state, reference, project, teams, persons, assets</code>.
              Multi-value fields (teams / persons / assets) use <code>|</code> as separator.
              Dates use <code>YYYY-MM-DD</code>.
            </p>
            {parseError && <p className="import-parse-error">{parseError}</p>}
            <div
              className="import-dropzone"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            >
              <span className="import-drop-icon">⬆</span>
              <span>Click to browse or drop a .csv file here</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="import-file-input"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <div className="modal-actions">
              <button type="button" className="template-link" onClick={downloadTemplate}>
                ⬇ template CSV
              </button>
              <div className="spacer" />
              <button type="button" className="ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {state === "preview" && (
          <>
            <div className="import-summary">
              <span className="import-ok">{validCount} valid</span>
              {invalidCount > 0 && <span className="import-bad">{invalidCount} invalid (will be skipped)</span>}
            </div>
            {parseError && <p className="import-parse-error">{parseError}</p>}
            <div className="import-table-wrap">
              <table className="import-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Importance</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.idx} className={r.error ? "row-invalid" : ""}>
                      <td>{r.idx}</td>
                      <td>{r.input?.title ?? "—"}</td>
                      <td>{r.input?.type ?? "—"}</td>
                      <td>{r.input?.importance ?? "—"}</td>
                      <td className="row-error-msg">{r.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => { setState("idle"); setRows([]); }}>
                Back
              </button>
              <div className="spacer" />
              <button type="button" className="ghost" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="primary"
                disabled={validCount === 0}
                onClick={() => { void handleImport(); }}
              >
                Import {validCount} pin{validCount !== 1 ? "s" : ""}
              </button>
            </div>
          </>
        )}

        {state === "importing" && (
          <p className="import-hint" style={{ textAlign: "center", padding: "24px 0" }}>Importing…</p>
        )}

        {state === "done" && result && (
          <>
            <div className="import-summary">
              <span className="import-ok">✓ {result.created.length} pin{result.created.length !== 1 ? "s" : ""} created</span>
              {result.errors.length > 0 && (
                <span className="import-bad">{result.errors.length} skipped</span>
              )}
            </div>
            {result.errors.length > 0 && (
              <ul className="import-errors">
                {result.errors.map((e) => (
                  <li key={e.row}>Row {e.row}: {e.message}</li>
                ))}
              </ul>
            )}
            <div className="modal-actions">
              <div className="spacer" />
              <button type="button" className="primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

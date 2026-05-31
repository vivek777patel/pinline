export type PinType = "task" | "followup" | "finding";
export type Importance = "critical" | "high" | "medium" | "low";
export type Status = "open" | "in_progress" | "blocked" | "done";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type RemediationState =
  | "triaged"
  | "in_remediation"
  | "remediated"
  | "verified"
  | "accepted_risk"
  | "false_positive";

export const STATUSES: Status[] = ["open", "in_progress", "blocked", "done"];
export const REMEDIATION_STATES: RemediationState[] = [
  "triaged",
  "in_remediation",
  "remediated",
  "verified",
  "accepted_risk",
  "false_positive",
];

export interface Pin {
  id: string;
  title: string;
  type: PinType;
  importance: Importance;
  status: Status;
  due: string | null;
  nudge: string | null;
  snooze: string | null;
  closed: string | null;
  created: string;
  last_touched: string;
  severity: Severity | null;
  remediation_state: RemediationState | null;
  description: string | null;
  project: string | null;
  teams: string[];
  persons: string[];
  assets: string[];
  urgency?: number;
}

async function unwrap(res: Response): Promise<unknown> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? res.statusText);
  }
  return res.json();
}

export async function fetchPins(): Promise<Pin[]> {
  return (await unwrap(await fetch("/api/pins"))) as Pin[];
}

export async function quickAdd(text: string): Promise<void> {
  await unwrap(
    await fetch("/api/pins/quick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  );
}

export async function setStatus(id: string, status: Status): Promise<void> {
  await patch(id, { status });
}

export async function setRemediation(id: string, remediation_state: RemediationState | null): Promise<void> {
  await patch(id, { remediation_state });
}

export async function updatePin(id: string, body: Record<string, unknown>): Promise<void> {
  await patch(id, body);
}

export async function deletePin(id: string): Promise<void> {
  const res = await fetch(`/api/pins/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("delete failed");
}

async function patch(id: string, body: Record<string, unknown>): Promise<void> {
  await unwrap(
    await fetch(`/api/pins/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

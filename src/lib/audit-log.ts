// Real, persisted, append-only audit trail. Replaces the old hardcoded mock in
// routes/audit.tsx. Any module records a mutating action by calling `logAudit`;
// the Audit Logs page reads the stream via `getAuditEvents()`.
//
// Events are stored newest-first under a versioned localStorage key and capped
// so the log can't grow without bound. Writes are best-effort and never throw,
// so an audit failure can never break the action it was recording.

import { getAuthUser } from "@/lib/auth";

export type AuditEvent = {
  id: string;
  /** ISO timestamp (sortable). */
  ts: string;
  /** Who performed the action — logged-in user name, falling back to role/System. */
  actor: string;
  /** What happened — a short verb phrase, e.g. "Approved", "Created", "Stock +". */
  action: string;
  /** Functional area, e.g. "Procurement", "Quality Control", "Inventory". */
  module: string;
  /** The record the action targeted (id or human label). */
  entity: string;
  /** Optional free-text detail for the drill-down. */
  detail?: string;
};

const KEY = "harvest-data-v1:audit-log";
const MAX = 500;

/** All recorded audit events, newest-first (empty if none / unavailable). */
export function getAuditEvents(): AuditEvent[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw != null) return JSON.parse(raw) as AuditEvent[];
  } catch {
    /* unavailable / corrupt */
  }
  return [];
}

/**
 * Append an audit event. `actor` defaults to the logged-in user (then their
 * role, then "System"). Returns nothing and never throws.
 */
export function logAudit(e: {
  action: string;
  module: string;
  entity: string;
  detail?: string;
  actor?: string;
}): void {
  try {
    const user = getAuthUser();
    const ev: AuditEvent = {
      id: `AUD-${Date.now().toString(36).toUpperCase()}-${Math.floor(performance.now()).toString(36)}`,
      ts: new Date().toISOString(),
      actor: e.actor ?? user?.name ?? user?.role ?? "System",
      action: e.action,
      module: e.module,
      entity: e.entity,
      detail: e.detail,
    };
    const next = [ev, ...getAuditEvents()].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable / quota — non-fatal, must never break the action */
  }
}

/** Clear the audit stream (admin utility). */
export function clearAuditLog(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}

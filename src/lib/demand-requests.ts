// Shared, localStorage-backed store for Demand Requests. The web keeps its live
// demands in the in-memory WorkflowProvider; this module mirrors that list to a
// localStorage key so OTHER surfaces (notably the mobile app) can read the same
// demands and raise new ones that show up on the web. The WorkflowProvider
// hydrates from — and persists to — this key, making it the single shared source.
//
// Mirrors the purchase-requisitions.ts bridge pattern (getDemandRequests /
// addDemandRequest) used by the mobile Purchase Requisition screen.

import { demandRequests as seedDemands } from "@/lib/sample-data";
import type { WfDemandRequest, WfDemandItem } from "@/lib/workflow-store";

export const DEMAND_STORAGE_KEY = "harvest-data-v1:demand-requests";

// The seed mapped into the full WfDemandRequest shape — identical to the mapping
// WorkflowProvider used before it hydrated from here, so the web renders these
// unchanged when localStorage is empty.
export function seedDemandRequests(): WfDemandRequest[] {
  return seedDemands.map((d) => ({
    id: d.id,
    reference: d.reference,
    requestedBy: d.requestedBy,
    role: d.role,
    date: d.date,
    status: d.status as WfDemandRequest["status"],
    items: d.items.map((i) => ({ ...i })),
    note: d.note,
    source: "Kitchen",
    officeId: "OFF-001",
    warehouseId: "WH-003",
  }));
}

/** All demand requests (persisted list if present, else the seed). */
export function getDemandRequests(): WfDemandRequest[] {
  try {
    const raw = window.localStorage.getItem(DEMAND_STORAGE_KEY);
    if (raw != null) return JSON.parse(raw) as WfDemandRequest[];
  } catch {
    /* unavailable / corrupt — fall through to seed */
  }
  return seedDemandRequests();
}

/** Persist the full demand list (used by the WorkflowProvider on every change). */
export function saveDemandRequests(list: WfDemandRequest[]): void {
  try {
    window.localStorage.setItem(DEMAND_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* best-effort — localStorage may be unavailable */
  }
}

/**
 * Create and persist a new demand request into the same list the web reads.
 * Assigns the next `DR-####` id (max suffix + 1, floored at 9000), defaults the
 * fields the web relies on (status "Pending Approval", role, source, office /
 * warehouse), prepends it, and returns the created record. Best-effort — never
 * throws. The web picks it up on its next WorkflowProvider mount.
 */
export function addDemandRequest(input: {
  requestedBy: string;
  items: WfDemandItem[];
  note?: string;
  role?: string;
  source?: string;
  officeId?: string;
  warehouseId?: string;
  date?: string;
}): WfDemandRequest {
  const list = getDemandRequests();
  const maxNum = list.reduce((m, r) => {
    const n = Number(String(r.id).split("-").pop());
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 9000);
  const rec: WfDemandRequest = {
    id: `DR-${maxNum + 1}`,
    reference: input.note?.slice(0, 24) || `MOB-${String(list.length + 1).padStart(4, "0")}`,
    requestedBy: input.requestedBy,
    role: input.role ?? "Kitchen Supervisor",
    date: input.date ?? new Date().toLocaleString(),
    status: "Pending Approval",
    items: input.items,
    note: input.note ?? "Raised from mobile app.",
    source: input.source ?? "Kitchen",
    officeId: input.officeId ?? "OFF-001",
    warehouseId: input.warehouseId ?? "WH-003",
  };
  saveDemandRequests([rec, ...list]);
  return rec;
}

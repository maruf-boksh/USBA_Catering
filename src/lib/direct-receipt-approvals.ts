import { useSyncExternalStore } from "react";
import type { WfGRN } from "@/lib/workflow-store";

// ─────────────────────────────────────────────────────────────────────────────
// Direct-receipt approval queue. A "Direct Receive" (spot buy, no PO) is now
// submitted here instead of being recorded immediately — it surfaces in
// Approval Management (Goods Receipt category) and is only recorded as a GRN
// (routed to Quality Control) once an approver signs off, mirroring the other
// approval flows. Persisted so the receive screen and the approval screen —
// separate routes — share the same queue.
// ─────────────────────────────────────────────────────────────────────────────

export type DirectReceiptApproval = {
  id: string;            // DRC-#####
  dpRef: string;         // DP-YYYY-##### (poRef of the GRN once recorded)
  vendor: string;
  amount: number;
  itemsCount: number;
  approver?: string;     // optional — approving authority is decided in Approval Management
  requestedBy: string;   // who received/submitted it
  requestedAt: string;   // "YYYY-MM-DD HH:mm"
  justification: string;
  attachments: string[]; // uploaded file names
  /** Fully-formed GRN payload — recorded verbatim via addGRN on approval. */
  grn: WfGRN;
  /** If this direct receive answers a PR shortfall, the receipts to write back. */
  sourcePrId?: string;
  prReceipts?: { lineId: string; qty: number }[];
  status: "Pending" | "Approved" | "Rejected";
  rejectionReason?: string;
  processedBy?: string;
  processedAt?: string;
};

const STORAGE_KEY = "harvest-direct-receipt-approvals-v1";

function load(): DirectReceiptApproval[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as DirectReceiptApproval[]) : [];
  } catch {
    return [];
  }
}

function persist(list: DirectReceiptApproval[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* best-effort */
  }
}

let current: DirectReceiptApproval[] = load();
const listeners = new Set<() => void>();

function emit() {
  persist(current);
  for (const l of listeners) l();
}

export function getDirectReceiptApprovals(): DirectReceiptApproval[] {
  return current;
}

export function addDirectReceiptApproval(entry: DirectReceiptApproval): void {
  current = [entry, ...current];
  emit();
}

export function setDirectReceiptApprovalStatus(
  id: string,
  status: DirectReceiptApproval["status"],
  extra: Partial<Pick<DirectReceiptApproval, "rejectionReason" | "processedBy" | "processedAt">> = {},
): void {
  current = current.map((d) => (d.id === id ? { ...d, status, ...extra } : d));
  emit();
}

export function subscribeDirectReceiptApprovals(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useDirectReceiptApprovals(): DirectReceiptApproval[] {
  return useSyncExternalStore(
    (cb) => subscribeDirectReceiptApprovals(cb),
    getDirectReceiptApprovals,
    getDirectReceiptApprovals,
  );
}

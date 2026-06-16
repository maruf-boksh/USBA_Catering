import { useSyncExternalStore } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Approval reviews — "returned for correction" notes, centralised.
//
// When an approver reviews (rather than approves/rejects) a request, they leave
// a comment and send it back to the requester for correction. Rather than add
// review fields to every module's record type (RFQ, Quotation, PO, Demand,
// Production, Maintenance, Stock Adjustment …), we keep one persistent store
// keyed by `${category}::${refId}`. Approval Management writes here; each
// module's requester screen reads it to show a "Reviewed" badge + comment, and
// clears it on edit/resubmit so the request re-enters the approval queue.
//
// (Flight/Crew orders are the exception — they persist the review on the order
// row itself via flight-orders-store, since Order Management already reads it.)
//
// Stored under localStorage["harvest-approval-reviews-v1"].
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalReview = {
  /** What the requester needs to change. */
  comment: string;
  /** Who returned it (role label). */
  by: string;
  /** When it was returned ("YYYY-MM-DD HH:MM"). */
  at: string;
};

type Reviews = Record<string, ApprovalReview>;

const STORAGE_KEY = "harvest-approval-reviews-v1";

/** Stable key for a reviewed record. Category must match the Approval
 *  Management category label the record is filed under. */
export function reviewKey(category: string, refId: string): string {
  return `${category}::${refId}`;
}

function load(): Reviews {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Reviews;
  } catch {
    return {};
  }
}

function persist(reviews: Reviews) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
  } catch {
    // localStorage may be unavailable (Safari private mode etc.) — fail silent.
  }
}

let current: Reviews = load();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function getApprovalReviews(): Reviews {
  return current;
}

export function getReview(category: string, refId: string): ApprovalReview | undefined {
  return current[reviewKey(category, refId)];
}

export function setReview(category: string, refId: string, review: ApprovalReview) {
  current = { ...current, [reviewKey(category, refId)]: review };
  persist(current);
  notify();
}

export function clearReview(category: string, refId: string) {
  const key = reviewKey(category, refId);
  if (!(key in current)) return;
  const next = { ...current };
  delete next[key];
  current = next;
  persist(current);
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Whole-map hook — used by Approval Management to overlay every category. */
export function useApprovalReviews(): Reviews {
  return useSyncExternalStore(subscribe, getApprovalReviews, getApprovalReviews);
}

/** Single-record hook — used by module screens to show one row's review. */
export function useRecordReview(category: string, refId: string): ApprovalReview | undefined {
  const all = useApprovalReviews();
  return all[reviewKey(category, refId)];
}

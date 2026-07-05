// Galley plan drafts — a working plan saved per dispatch entry before it is
// forwarded to aircraft loading. Kept separate from the forwarded loading
// records (which Dispatch Monitoring / Loading QC execute against) so an
// in-progress plan can be resumed any time. Shared by the Galley Plan page
// (save / resume) and the Galley Plan Drafts page (manage / discard).

import type { GalleyPlan } from "@/lib/galley-items";

// A saved draft carries the transfer source chosen in the planner, so it can be
// forwarded straight from the list page later. Sign-off is captured downstream,
// on the Loading QC & Sign-Off page.
export type GalleyDraft = {
  plan: GalleyPlan;
  savedAt: string;
  source?: { officeId: string; warehouseId: string };
};
export type GalleyDrafts = Record<string, GalleyDraft>;

const DRAFT_KEY = "galley_plan_drafts";

export function loadDrafts(): GalleyDrafts {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}") as GalleyDrafts; }
  catch { return {}; }
}

export function persistDrafts(d: GalleyDrafts) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* non-fatal */ }
}

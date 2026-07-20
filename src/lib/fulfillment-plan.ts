import { getItemStock } from "@/lib/inventory-stock";
import { roundQty } from "@/lib/num";
import type { WfDemandRequest } from "@/lib/workflow-store";

// ─────────────────────────────────────────────────────────────────────────────
// Demand fulfilment plan — how each shortfall item on a demand request is
// procured. The procurement quantity (fixed at the shortfall) is ALLOCATED
// across one or more procurement methods when the demand is APPROVED (Approval
// Management → demand detail), then read back by Item Issue's demand View
// dialog, which runs each method for its allocated qty.
//
// Methods are config-driven (PROCUREMENT_METHODS) so the UI scales: adding a
// method is one entry here — the approval allocator and the Item Issue runner
// both iterate this list. Persisted via usePersistedState under localStorage
// ["harvest-data-v1:item-issue-fulfillment-plan"].
// ─────────────────────────────────────────────────────────────────────────────

export type ProcurementMethod = {
  key: string;
  label: string;   // full name, shown in the allocator
  short: string;   // compact chip label
  swatch: string;  // solid bg (dot / active state)
  text: string;    // text colour for chips
  soft: string;    // soft bg for chips
};

export const PROCUREMENT_METHODS: ProcurementMethod[] = [
  { key: "direct",      label: "Direct Receive",       short: "Direct", swatch: "bg-blue-600",  text: "text-blue-700",  soft: "bg-blue-50" },
  { key: "requisition", label: "Purchase Requisition", short: "PR",     swatch: "bg-amber-500", text: "text-amber-700", soft: "bg-amber-50" },
];

export const PROCUREMENT_METHOD_BY_KEY = new Map(PROCUREMENT_METHODS.map((m) => [m.key, m]));

// A saved plan line: the item's procurement qty split across methods.
export type Allocation = Record<string, number>; // methodKey → qty
export type PlanLine = { qty: number; allocations: Allocation };
export type FulfillmentPlan = Record<string, Record<string, PlanLine>>; // demandId → itemId → line
export const FULFILL_PLAN_KEY = "item-issue-fulfillment-plan";

/** Sum of a method allocation map (rounded). */
export function allocationTotal(alloc: Allocation | undefined): number {
  if (!alloc) return 0;
  return roundQty(Object.values(alloc).reduce((s, n) => s + (Number(n) || 0), 0));
}

/** Qty allocated to one method on a plan line (0 if none). */
export function allocationFor(line: PlanLine | undefined, key: string): number {
  return roundQty(Number(line?.allocations?.[key]) || 0);
}

// Shortfall (required − on-hand) for a demand's items, > 0 only.
export function demandShortfalls(demand: WfDemandRequest) {
  return demand.items
    .map((it) => ({ ...it, shortfall: roundQty(it.qty - getItemStock(it.id || it.name)) }))
    .filter((it) => it.shortfall > 0);
}

// ── Running a method ─────────────────────────────────────────────────────────
// Each procurement method hands its allocated lines to a prefilled screen via
// sessionStorage, then the caller navigates. Shared so the Item Issue demand
// dialog and the Demand Requests review dialog stage identical payloads.

type ProcureLine = { id: string; name: string; uom: string; qty: number };
type DemandRef = { id: string; officeId?: string; warehouseId?: string };

/** Stage the Direct Receive prefill; returns the route to navigate to (or null). */
export function stageDirectReceive(demand: DemandRef, lines: ProcureLine[]): string | null {
  if (typeof window === "undefined" || lines.length === 0) return null;
  sessionStorage.setItem("direct-receive-prefill", JSON.stringify({
    source: demand.id,
    justification: `Direct receive against Demand Request ${demand.id} — ${lines.length} shortfall material${lines.length === 1 ? "" : "s"}.`,
    officeId: demand.officeId, warehouseId: demand.warehouseId,
    lines: lines.map((l) => ({ name: l.name, qty: l.qty, uom: l.uom })),
  }));
  return "/receive-item";
}

/** Stage the Purchase Requisition prefill; returns the route to navigate to (or null). */
export function stageRequisition(demand: DemandRef, requestedBy: string, lines: ProcureLine[]): string | null {
  if (typeof window === "undefined" || lines.length === 0) return null;
  sessionStorage.setItem("pr-prefill-from-inventory", JSON.stringify({
    source: demand.id,
    requestedBy,
    justification: `Raised from Demand Request ${demand.id} to cover ${lines.length} shortfall material${lines.length === 1 ? "" : "s"}.`,
    officeId: demand.officeId, warehouseId: demand.warehouseId,
    lines: lines.map((l, i) => ({ id: `LN-${demand.id}-${i + 1}`, itemName: l.name, description: l.id, qty: l.qty, uom: l.uom, rate: 0 })),
  }));
  return "/purchase-requisition";
}

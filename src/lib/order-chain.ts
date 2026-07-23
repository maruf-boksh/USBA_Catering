// ─────────────────────────────────────────────────────────────────────────────
// Order → Production → Packaging → Dispatch → Galley — the chain resolvers.
//
// Every module in this pipeline needs the same question answered: "which flight
// order does this thing belong to?" Until now each page answered it its own way,
// and two of them answered it by INVENTING a link — hashing a production id onto
// an arbitrary flight order (`pool[n % pool.length]`). That is why the same
// batch could sit under "Unassigned" in Packaging and under BS-150 in Dispatch,
// and why a dialog could show one flight's crew/special counts against another
// flight's meals.
//
// This module is the single answer. It resolves only on real keys and returns
// `via` so a surface can say HOW something was matched instead of implying a
// link that was never recorded. Nothing here fabricates.
//
// The join spine, and the key each hop travels on:
//
//   Order Management   FlightOrder      ORD-… + flight + date
//         │                                   ▲
//         │  orderNo                          │ resolveFlightOrder()
//         ▼                                   │
//   Manifest line      PackagingRow     PRD-… (id) + productionOrderId + flight
//         │                                   ▲
//         │  productionOrderId                │ resolveManifestRow()
//         ▼                                   │
//   Production         WfProductionEntry PRO-…
//         │                                   ▲
//         │  QC batch code                    │
//         ▼                                   │
//   Packaging          PackagingBatch    batch = PRO-… or PRD-…
//         │
//         ▼
//   Dispatch           DispatchRecord    DSP-…  (manifest row's dspRef)
//         │
//         ▼
//   Galley / Monitoring DispatchEntry    flightId + packagingDate
// ─────────────────────────────────────────────────────────────────────────────

import type { FlightOrder } from "@/lib/flight-orders-store";
import type { PackagingRow } from "@/routes/dispatch";

/** Where a batch/row lands when nothing in the chain links it to a flight. */
export const UNASSIGNED_FLIGHT = "Unassigned";

/** How a manifest line was matched — surfaces use this to caveat weak links. */
export type ManifestLinkVia = "production" | "batch" | "order" | "item" | "none";

export type ManifestLink = { row?: PackagingRow; via: ManifestLinkVia };

/**
 * The manifest (dispatch/order) line a production or QC batch belongs to.
 *
 * A batch code is not one single thing: a live QC sign-off stamps the
 * production-order id (PRO-2026-…), while seeded and hand-keyed QC records carry
 * the kitchen production-batch code (PRD-…), which is the manifest row's OWN id.
 * Matching only on productionOrderId silently dropped every PRD-… batch.
 *
 * Order of preference, strongest first:
 *   1. productionOrderId — the explicit production link
 *   2. the row's id       — the kitchen batch code
 *   3. servesOrderNos     — the Order #s the production run was raised against
 *                           (WfProductionEntry records this at creation), matched
 *                           to a line of that order carrying the same item
 *   4. the cooked item on a line (same date first) — weakest, flagged "item"
 */
export function resolveManifestRow(
  ref: { batch: string; item?: string; date?: string; servesOrderNos?: string[] },
  rows: PackagingRow[],
): ManifestLink {
  const byProduction = rows.find((r) => r.productionOrderId === ref.batch);
  if (byProduction) return { row: byProduction, via: "production" };

  const byRowId = rows.find((r) => r.id === ref.batch);
  if (byRowId) return { row: byRowId, via: "batch" };

  // The production run knows which orders it was raised for — a real link, so it
  // outranks matching on item name alone.
  if (ref.servesOrderNos?.length) {
    const served = new Set(ref.servesOrderNos);
    const byOrder =
      rows.find((r) => r.orderNo && served.has(r.orderNo) && r.mealName === ref.item) ??
      rows.find((r) => r.orderNo && served.has(r.orderNo));
    if (byOrder) return { row: byOrder, via: "order" };
  }

  if (ref.item) {
    const byItem =
      rows.find((r) => r.mealName === ref.item && r.date === ref.date) ??
      rows.find((r) => r.mealName === ref.item);
    if (byItem) return { row: byItem, via: "item" };
  }
  return { via: "none" };
}

/**
 * Every manifest line of the same service as `row` — one flight's full meal
 * manifest (same flight + dep time + date).
 */
export function manifestLinesFor(row: PackagingRow, rows: PackagingRow[]): PackagingRow[] {
  return rows.filter((r) => r.flight === row.flight && r.depTime === row.depTime && r.date === row.date);
}

/**
 * The Order Management order behind a flight reference.
 *
 * Order # wins: it is the explicit link the manifest carries (ORD-3415 →
 * FO-008) and it holds even when the manifest's date differs from the order's,
 * which it does throughout the seed data. Flight + date is the fallback.
 *
 * Matching on flight ALONE is deliberately absent. It looks harmless and is not:
 * a flight number recurs on many dates, so it quietly returns another day's leg
 * and reports that leg's sector, ETD, crew and special-meal counts against the
 * flight in front of you.
 */
export function resolveFlightOrder(
  ref: { flight?: string; date?: string; orderNo?: string },
  orders: FlightOrder[],
): FlightOrder | undefined {
  const isPax = (o: FlightOrder) => (o.orderType ?? "flight") !== "crew";

  if (ref.orderNo) {
    const exact = orders.find((o) => o.orderNo === ref.orderNo && o.flight === ref.flight && isPax(o));
    if (exact) return exact;
    if (!ref.flight) {
      const byOrder = orders.find((o) => o.orderNo === ref.orderNo && isPax(o));
      if (byOrder) return byOrder;
    }
  }
  if (!ref.flight || !ref.date) return undefined;
  return orders.find((o) => o.flight === ref.flight && o.date === ref.date && isPax(o));
}

/** The separately-booked crew-meal order sharing an Order # with a flight leg. */
export function resolveCrewOrder(
  ref: { flight?: string; orderNo?: string },
  orders: FlightOrder[],
): FlightOrder | undefined {
  if (!ref.orderNo) return undefined;
  return orders.find(
    (o) => o.orderNo === ref.orderNo && o.flight === ref.flight && (o.orderType ?? "flight") === "crew",
  );
}

/** "DAC → CXB" → "CXB → DAC". Returns the input unchanged when the sector is
 *  not a two-station string we can flip. */
export function reverseSector(sector: string): string {
  const parts = sector.split(/→|—|–|-/).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return sector;
  return `${parts[1]} → ${parts[0]}`;
}

/** How a return leg was paired to its outbound — surfaces say which. */
export type ReturnLegVia = "pairId" | "orderNo";
export type ReturnLeg = { order: FlightOrder; via: ReturnLegVia };

/**
 * The other half of an order's round trip.
 *
 * An explicit Trip Ref (`pairId`, stamped on bulk upload) is authoritative: bulk
 * upload gives ONE Order # to every flight on a date, so three DAC↔CXB round
 * trips that day share an Order # and reverse-sector alone cannot tell which
 * return belongs to which outbound. Without a Trip Ref we fall back to same
 * Order # + opposite direction, preferring the exact reverse sector.
 *
 * Order TYPE is always matched: crew orders can share an Order # with a flight
 * leg, and a flight's return leg is a flight, never the crew order.
 *
 * Lives here rather than in Dispatch because Packaging pairs the same way — a
 * round trip is packaged as one job, and the two pages must agree on what pairs
 * with what or the outbound and its return end up in separate runs.
 */
export function resolveReturnLeg(
  order: FlightOrder | null | undefined,
  orders: FlightOrder[],
): ReturnLeg | null {
  if (!order) return null;
  const opp = order.direction === "Return" ? "Outbound" : "Return";
  const orderKind = order.orderType ?? "flight";
  const rev = reverseSector(order.sector);
  const sameKind = (o: FlightOrder) =>
    (o.orderType ?? "flight") === orderKind && o.flight !== order.flight && o.direction === opp;

  if (order.pairId) {
    const paired = orders.filter((o) => o.pairId === order.pairId && sameKind(o));
    if (paired.length > 0) {
      return { order: paired.find((o) => o.sector === rev) ?? paired[0], via: "pairId" };
    }
  }
  if (!order.orderNo) return null;
  const legs = orders.filter((o) => o.orderNo === order.orderNo && sameKind(o));
  if (legs.length === 0) return null;
  return { order: legs.find((o) => o.sector === rev) ?? legs[0], via: "orderNo" };
}

/** Everything the chain knows about one batch: its manifest line (if any), its
 *  Order Management order (if any), and how it was reached. */
export type BatchChain = {
  row?: PackagingRow;
  order?: FlightOrder;
  flight?: string;
  orderNo?: string;
  depTime?: string;
  date?: string;
  via: ManifestLinkVia;
};

/**
 * Flight + order identity for a batch — the full walk, manifest first.
 *
 * A freshly produced run has NO manifest line: the manifest is raised by the
 * dispatch flow, which happens after production. Stopping at the manifest filed
 * every same-day production under "Unassigned" even though the run itself
 * records the Order #s it was raised for (`servesOrderNos`, set from that date's
 * menu plan). So when no line matches we walk straight to the order book on that
 * recorded link — a real one, not a guess. Only a run tagged to no order at all
 * ends up unassigned.
 */
export function resolveBatchChain(
  ref: { batch: string; item?: string; date?: string; servesOrderNos?: string[] },
  rows: PackagingRow[],
  orders: FlightOrder[],
): BatchChain {
  const link = resolveManifestRow(ref, rows);
  if (link.row) {
    const r = link.row;
    return {
      row: r,
      order: resolveFlightOrder({ flight: r.flight, date: r.date, orderNo: r.orderNo }, orders),
      flight: r.flight, orderNo: r.orderNo, depTime: r.depTime, date: r.date,
      via: link.via,
    };
  }
  for (const orderNo of ref.servesOrderNos ?? []) {
    const order = resolveFlightOrder({ orderNo }, orders);
    if (order) {
      return {
        order, flight: order.flight, orderNo: order.orderNo,
        depTime: order.etd, date: order.date, via: "order",
      };
    }
  }
  return { via: "none" };
}

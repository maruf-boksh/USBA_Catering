// Galley Handing / Taking sheet — stowage plan + printable document.
//
// The field catalog itself lives in the Galley Item Master
// (src/lib/galley-items.ts); everything here renders whatever that master
// contains, so custom items appear in the printed sheet automatically.

import { getGalleySections, type GalleyPlan } from "@/lib/galley-items";

export type { GalleyPlan, GalleySheetField, GalleySheetSection } from "@/lib/galley-items";
export { getGalleySections } from "@/lib/galley-items";

// ── Galley stowage (trolley loading) plan ────────────────────────────────────
// Derives a standard galley loading plan — which ATLAS unit (full/half trolley,
// standard unit, oven case) sits at which galley position and what it carries —
// from the sheet's meal counts and equipment numbers, per aircraft type.
// Narrow-body jets (737) split FWD/AFT galleys; turboprops (ATR / Dash 8) have
// a single main galley.
export type StowageUnit = { pos: string; unit: string; contents: string; qty: string };
export type StowageGalley = { galley: string; units: StowageUnit[] };

export function buildStowagePlan(g: GalleyPlan, aircraft?: string): StowageGalley[] {
  const n = (k: string) => Number(g[k]) || 0;
  const singleGalley = /ATR|DASH|Q400|AT7|DH8/i.test(aircraft ?? "");

  const fwd: Omit<StowageUnit, "pos">[] = [];
  const aft: Omit<StowageUnit, "pos">[] = [];

  // Beverage trolley + crew service ride FWD; meals, ovens and waste ride AFT.
  // Cold-beverage & juice counts come from the item-master rollup totals (not a
  // hardcoded brand list), so new sodas flow into the trolley automatically.
  const coldBtl = n("totalColdBev");
  const waterBtl = n("water250Pax") + n("water500Crew");
  if (coldBtl + waterBtl + n("totalJuice") > 0) {
    fwd.push({ unit: "Full Trolley", contents: "Cold beverages, water & juice", qty: `${coldBtl + n("totalJuice")} btl · ${waterBtl} water` });
  }
  const crewMeals = n("crewBreakfast") + n("crewLunch") + n("crewExtraLunchVeg");
  if (crewMeals + n("crewLightSnacks") + n("crewDessert") > 0) {
    fwd.push({ unit: "Half Trolley", contents: "Crew meals, snacks & dessert", qty: `${crewMeals} meals` });
  }

  const depMeals = n("totalDepMeal") || n("depMealLoad");
  const fullCarts = n("fullMealCart");
  for (let i = 0; i < fullCarts; i++) {
    aft.push({
      unit: "Full Trolley",
      contents: `Departure meal trays (cart ${i + 1} of ${fullCarts})`,
      qty: `≈${Math.ceil(depMeals / fullCarts)} trays`,
    });
  }
  const arrMeals = n("totalArrMeal") || n("arrMealLoad");
  const halfCarts = n("halfMealCart");
  for (let i = 0; i < halfCarts; i++) {
    aft.push({ unit: "Half Trolley", contents: `Arrival meal trays (cart ${i + 1} of ${halfCarts})`, qty: `≈${Math.ceil(arrMeals / halfCarts)} trays` });
  }
  const ovens = n("ovenCase");
  for (let i = 0; i < ovens; i++) {
    aft.push({ unit: "Oven Case", contents: "Hot entrées (loaded to ovens)", qty: `≈${Math.ceil(depMeals / ovens)} meals` });
  }
  for (let i = 0; i < n("fullWastageCart"); i++) aft.push({ unit: "Full Trolley", contents: "Wastage cart — empty, cabin returns", qty: "—" });
  for (let i = 0; i < n("halfWastageCart"); i++) aft.push({ unit: "Half Trolley", contents: "Wastage cart — empty, cabin returns", qty: "—" });

  const cabinetContents = [
    "Tea & coffee service, paper cups",
    "Amenities & consumables",
    "Forms, safety cards & medical kits",
    "Dry stores & condiments",
    "Service equipment & cutlery",
  ];
  for (let i = 0; i < n("standardCabinet"); i++) {
    (i % 2 === 0 ? fwd : aft).push({ unit: "Standard Unit", contents: cabinetContents[i % cabinetContents.length], qty: "—" });
  }

  const assign = (prefix: string, units: Omit<StowageUnit, "pos">[]): StowageUnit[] =>
    units.map((u, i) => ({ ...u, pos: `${prefix}-${String(i + 1).padStart(2, "0")}` }));

  if (singleGalley) {
    return [{ galley: "Main Galley (G2 · AFT)", units: assign("G2", [...fwd, ...aft]) }];
  }
  return [
    { galley: "FWD Galley (G1)", units: assign("G1", fwd) },
    { galley: "AFT Galley (G4)", units: assign("G4", aft) },
  ];
}

// ── Printable Handing / Taking sheet ─────────────────────────────────────────

export type GalleySheetMeta = {
  flightNo: string;
  sector: string;
  date: string;
  aircraft?: string;
  pax?: number | string;
  crew?: number | string;
  status?: string;
  signOff?: { label: string; name: string; designation: string; signedAt: string }[];
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Opens a print-formatted Handing / Taking sheet in a new window. */
export function printGalleySheet(plan: GalleyPlan, meta: GalleySheetMeta) {
  const val = (k: string) => {
    const v = (plan[k] ?? "").trim();
    return v === "" ? "—" : v;
  };

  const sectionHtml = getGalleySections().map((sec) => `
    <div class="sec">
      <h3>${esc(sec.title)}</h3>
      <table>
        ${sec.fields.map((f) => `
          <tr>
            <td class="lbl">${esc(f.label)}</td>
            <td class="qty">${esc(val(f.k))}${f.unit && val(f.k) !== "—" ? ` <span class="unit">${esc(f.unit)}</span>` : ""}</td>
          </tr>`).join("")}
      </table>
    </div>`).join("");

  const signHtml = meta.signOff?.length ? `
    <div class="sign">
      ${meta.signOff.map((s) => `
        <div class="sig">
          <div class="line">${esc(s.name)}</div>
          <div class="desig">${esc(s.designation)} · ${esc(s.signedAt)}</div>
          <div class="role">${esc(s.label)}</div>
        </div>`).join("")}
    </div>` : "";

  const html = `<!doctype html>
<html><head><meta charset="utf-8" /><title>Handing-Taking Sheet — ${esc(meta.flightNo)} ${esc(meta.date)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 11px/1.45 "Segoe UI", Arial, sans-serif; color: #111; margin: 24px; }
  header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  header h1 { font-size: 15px; margin: 0 0 2px; text-transform: uppercase; letter-spacing: .06em; }
  header .meta { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 11px; }
  header .meta b { font-size: 12px; }
  .cols { column-count: 3; column-gap: 16px; }
  .sec { break-inside: avoid; margin-bottom: 10px; }
  .sec h3, .stowage h3 { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; margin: 0 0 3px; border-bottom: 1px solid #999; padding-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; }
  .sec td { padding: 1px 0; vertical-align: top; }
  .sec .lbl { color: #333; }
  .sec .qty { text-align: right; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .unit { color: #777; font-weight: 400; font-size: 9px; }
  .stowage { margin-top: 14px; break-inside: avoid; }
  .stowage h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 6px; }
  .stow { margin-bottom: 8px; }
  .stow th, .stow td { border: 1px solid #bbb; padding: 2px 6px; text-align: left; font-size: 10px; }
  .stow th { background: #f0f0f0; text-transform: uppercase; font-size: 9px; letter-spacing: .05em; }
  .sign { display: flex; gap: 18px; margin-top: 26px; }
  .sig { flex: 1; text-align: center; }
  .sig .line { border-bottom: 1px solid #111; padding-bottom: 3px; font-weight: 600; }
  .sig .desig { font-size: 9px; color: #555; margin-top: 2px; }
  .sig .role { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; margin-top: 2px; }
  @media print { body { margin: 10mm; } }
</style></head>
<body>
  <header>
    <h1>US-Bangla Airlines · Flight Catering — Handing / Taking Sheet</h1>
    <div class="meta">
      <span>Flight <b>${esc(meta.flightNo)}</b></span>
      <span>Sector <b>${esc(meta.sector)}</b></span>
      <span>Date <b>${esc(meta.date)}</b></span>
      ${meta.aircraft ? `<span>Aircraft <b>${esc(meta.aircraft)}</b></span>` : ""}
      ${meta.pax != null ? `<span>PAX <b>${esc(meta.pax)}</b></span>` : ""}
      ${meta.crew != null ? `<span>Crew <b>${esc(meta.crew)}</b></span>` : ""}
      ${meta.status ? `<span>Status <b>${esc(meta.status)}</b></span>` : ""}
    </div>
  </header>
  <div class="cols">${sectionHtml}</div>
  ${signHtml}
  <script>window.addEventListener('load', function () { window.print(); });</script>
</body></html>`;

  const w = window.open("", "_blank", "width=980,height=760");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

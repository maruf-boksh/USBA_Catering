import type { FormDefinition, FormFieldDef } from "../types/formAccessControl.types";
import { PAGE_CONTENT_CATALOG } from "@/lib/page-content-catalog";
import { getPageLabel } from "@/lib/nav-utils";

// Form registry for Form Access Control — derived from the app's real page
// content catalog (the same field metadata the User Access Control / role-
// permission editor uses). Every route that declares form `fields` in
// page-content-catalog.ts surfaces here as a controllable form, with its actual
// fields — so the FAC list stays in lock-step with the real forms instead of a
// hand-maintained placeholder list. Add fields to a page's catalog entry and
// they appear here automatically.

// The first field of a form is its identity/reference field (e.g. Item Code,
// Supplier Code, PR No.) — kept locked so an admin can't hide or un-mandate the
// key that identifies the record.
const LOCKED_LEADING_FIELDS = 1;

/** Build a form definition from a route's catalogued field elements. */
function formForRoute(route: string, fieldEls: { id: string; label: string }[]): FormDefinition {
  const fields: FormFieldDef[] = fieldEls.map((el, i) => ({
    // Strip the catalog's "field-" prefix so keys read as clean field names.
    key: el.id.replace(/^field-/, ""),
    label: el.label,
    // Sensible defaults: everything visible, the identity field mandatory+locked.
    defaultVisible: true,
    defaultMandatory: i < LOCKED_LEADING_FIELDS,
    locked: i < LOCKED_LEADING_FIELDS,
  }));
  return {
    key: route,                       // route is a stable unique form key
    name: getPageLabel(route),        // human page/form name from the nav map
    description: `Field visibility & mandatory control for the ${getPageLabel(route)} form.`,
    fields,
  };
}

export const FORMS: FormDefinition[] = Object.entries(PAGE_CONTENT_CATALOG)
  .map(([route, els]) => {
    const fieldEls = els.filter((e) => e.kind === "field");
    return fieldEls.length > 0 ? formForRoute(route, fieldEls) : null;
  })
  .filter((f): f is FormDefinition => f !== null)
  .sort((a, b) => a.name.localeCompare(b.name));

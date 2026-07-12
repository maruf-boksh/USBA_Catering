import type { Tenant } from "../types/formAccessControl.types";
import { companies, offices, warehouses } from "@/lib/sample-data";

// Org hierarchy for the Form Access Control scope — derived from the app's real
// Company → Office → Warehouse master data (the same hierarchy the Location
// picker uses across the app) so FAC rules scope to actual org units instead of
// illustrative placeholders. Codes are the canonical entity ids (CMP-/OFF-/WH-)
// so a rule's scope lines up with the officeId / warehouseId used everywhere.
//   Tenant       = Company
//   Concern      = Office      (office.companyId → company)
//   Sub-concern  = Warehouse   (warehouse.officeId → office)
export const TENANTS: Tenant[] = companies.map((company) => ({
  code: company.id,
  name: company.name,
  concerns: offices
    .filter((office) => office.companyId === company.id)
    .map((office) => ({
      code: office.id,
      name: office.name,
      subConcerns: warehouses
        .filter((wh) => wh.officeId === office.id)
        .map((wh) => ({ code: wh.id, name: wh.name })),
    })),
}));

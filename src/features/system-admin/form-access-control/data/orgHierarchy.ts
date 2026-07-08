import type { Tenant } from "../types/formAccessControl.types";

// Illustrative org hierarchy — two tenants, each with a few concerns and
// sub-concerns. Static reference data per the FAC domain spec.
export const TENANTS: Tenant[] = [
  {
    code: "USBA",
    name: "USBA Group",
    concerns: [
      {
        code: "CATERING",
        name: "Catering",
        subConcerns: [
          { code: "FLIGHT-KTC", name: "Flight Kitchen — Chattogram" },
          { code: "FLIGHT-KTD", name: "Flight Kitchen — Dhaka" },
          { code: "LOUNGE", name: "Lounge Services" },
        ],
      },
      {
        code: "GROUND-HANDLING",
        name: "Ground Handling",
        subConcerns: [
          { code: "RAMP", name: "Ramp Services" },
          { code: "CARGO", name: "Cargo Handling" },
        ],
      },
    ],
  },
  {
    code: "HARVEST",
    name: "Harvest Holdings",
    concerns: [
      {
        code: "RETAIL",
        name: "Retail Catering",
        subConcerns: [
          { code: "OUTLET-DHK", name: "Outlet — Dhaka" },
          { code: "OUTLET-CTG", name: "Outlet — Chattogram" },
        ],
      },
      {
        code: "CORP",
        name: "Corporate",
        subConcerns: [],
      },
    ],
  },
];

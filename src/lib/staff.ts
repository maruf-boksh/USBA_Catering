import type { Role } from "@/lib/roles";

/**
 * A staff member / system user. This is the single source of truth for the
 * people list — the User Access Control screen (routes/users.tsx) seeds and
 * edits this shape, and other modules (e.g. Item Issue recipient picker) read
 * the active roster via `getActiveStaff()`.
 */
export type StaffMember = {
  id: string;
  username: string;
  fullName: string;
  email: string;
  phone: string;
  role: Role;
  location: string;
  lastLogin: string;
  status: "Active" | "Inactive";
};

export const STAFF_SEED: StaffMember[] = [
  { id: "USR-001", username: "r.hossain",  fullName: "R. Hossain",   email: "r.hossain@us-bangla.com",  phone: "+880 1711-100001", role: "GM/Admin",                  location: "Head Office Dhaka",     lastLogin: "2026-05-20 09:14", status: "Active"   },
  { id: "USR-002", username: "s.ahmed",    fullName: "S. Ahmed",     email: "s.ahmed@us-bangla.com",    phone: "+880 1711-100002", role: "Menu Planner",              location: "Head Office Dhaka",     lastLogin: "2026-05-20 08:22", status: "Active"   },
  { id: "USR-003", username: "f.begum",    fullName: "F. Begum",     email: "f.begum@us-bangla.com",    phone: "+880 1711-100003", role: "Store & Inventory",         location: "Central Warehouse",     lastLogin: "2026-05-19 18:45", status: "Active"   },
  { id: "USR-004", username: "m.karim",    fullName: "Md. Karim",    email: "m.karim@us-bangla.com",    phone: "+880 1711-100004", role: "Procurement & Supply Chain", location: "Head Office Dhaka",    lastLogin: "2026-05-19 16:20", status: "Active"   },
  { id: "USR-005", username: "t.islam",    fullName: "T. Islam",     email: "t.islam@us-bangla.com",    phone: "+880 1711-100005", role: "Food Safety & QC",          location: "Hot Kitchen",           lastLogin: "2026-05-20 07:55", status: "Active"   },
  { id: "USR-006", username: "n.hossen",   fullName: "N. Hossen",    email: "n.hossen@us-bangla.com",   phone: "+880 1711-100006", role: "Packaging & Dispatch",      location: "Cold Kitchen",          lastLogin: "2026-05-15 10:11", status: "Active"   },
  { id: "USR-007", username: "a.rahman",   fullName: "A. Rahman",    email: "a.rahman@us-bangla.com",   phone: "+880 1711-100007", role: "Reports & Analytics",       location: "Head Office Dhaka",     lastLogin: "2026-04-28 12:30", status: "Inactive" },
];

// Mirror of the key used by usePersistedState in routes/users.tsx so reads here
// reflect users created / edited at runtime, not just the seed.
const STORAGE_KEY = "harvest-data-v1:users-rows";

/** Full roster (persisted if present, else seed). */
export function getStaff(): StaffMember[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw != null) return JSON.parse(raw) as StaffMember[];
  } catch {
    /* unavailable / corrupt — fall through to seed */
  }
  return STAFF_SEED;
}

/** Active staff only — the candidates an item issue can be handed to. */
export function getActiveStaff(): StaffMember[] {
  return getStaff().filter((s) => s.status === "Active");
}

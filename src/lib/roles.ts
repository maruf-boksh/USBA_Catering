import { createContext, useContext } from "react";

// Built-in roles ship with the app. Additional roles can be created at runtime
// from Configuration → User Access Control (see access-control.ts). Because
// roles are now dynamic, `Role` is a plain string rather than a closed union.
export const BUILTIN_ROLES = [
  "GM/Admin",
  "Meal Planner",
  "Production",
  "Packaging & Dispatch",
  "Store & Inventory",
  "Procurement & Supply Chain",
  "Food Safety & QC",
  "Maintenance & Asset",
  "Reports & Analytics",
] as const;

/** @deprecated kept for back-compat — prefer BUILTIN_ROLES / useAllRoles(). */
export const ROLES = BUILTIN_ROLES;

export type Role = string;

export const RoleContext = createContext<{
  role: Role;
  setRole: (r: Role) => void;
}>({ role: "GM/Admin", setRole: () => {} });

export const useRole = () => useContext(RoleContext);

/** Which sidebar group keys each role can see. "*" = all. */
export const ROLE_PERMS: Record<Role, string[] | "*"> = {
  "GM/Admin": "*",
  "Meal Planner": ["dashboard", "order-management", "meal-planning", "production"],
  "Production": ["dashboard", "production-kitchen", "production-bakery", "production-amenities", "qc"],
  "Packaging & Dispatch": ["dashboard", "production-dispatch"],
  "Store & Inventory": ["dashboard", "inventory", "supply-receive"],
  "Procurement & Supply Chain": ["dashboard", "supply", "inventory-bom"],
  "Food Safety & QC": ["dashboard", "qc"],
  "Maintenance & Asset": ["dashboard", "maintenance"],
  "Reports & Analytics": ["dashboard", "reports", "audit"],
};

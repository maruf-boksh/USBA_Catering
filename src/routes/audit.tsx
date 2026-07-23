import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KpiCard } from "@/components/common/KpiCard";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Activity, AlertTriangle, CheckCircle2, Users, Shield,
  Plus, Pencil, Trash2, Check, X, Eye, LogIn, LogOut,
  Download, Upload, Printer, Lock, FileText, Globe,
  Boxes, ShoppingCart, ChefHat, ThermometerSun, Plane, Wallet,
  Settings, UserCog, Filter, RotateCw, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { flagArrival } from "@/lib/arrival-flash";
import { getFlightOrders } from "@/lib/flight-orders-store";
import { getAuditEvents, type AuditEvent as LiveAuditEvent } from "@/lib/audit-log";

// ── Types & taxonomies ────────────────────────────────────────────────────

type Severity = "info" | "success" | "warning" | "critical";

type ActionKind =
  | "Create" | "Update" | "Delete" | "Approve" | "Reject" | "View"
  | "Login" | "Logout" | "Export" | "Import" | "Print" | "Lock";

type Module =
  | "Auth" | "Orders" | "Menu Planning" | "Production" | "Inventory"
  | "Procurement" | "Accounts" | "QC" | "Dispatch" | "Config" | "Users" | "Assets";

type Result = "Success" | "Failure";

type AuditEvent = {
  id: string;
  at: string;          // ISO-like "YYYY-MM-DD HH:MM:SS"
  user: string;
  userRole: string;
  module: Module;
  action: ActionKind;
  description: string;
  target: string;
  targetType: string;
  ip: string;
  device: string;
  result: Result;
  severity: Severity;
  changes?: Array<{ field: string; before: string; after: string }>;
};

const MODULE_META: Record<Module, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  "Auth":         { icon: Lock,         color: "bg-slate-100 text-slate-700 border-slate-200" },
  "Orders":       { icon: Plane,        color: "bg-sky-50 text-sky-700 border-sky-200" },
  "Menu Planning":{ icon: ChefHat,      color: "bg-amber-50 text-amber-700 border-amber-200" },
  "Production":   { icon: ChefHat,      color: "bg-orange-50 text-orange-700 border-orange-200" },
  "Inventory":    { icon: Boxes,        color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  "Procurement":  { icon: ShoppingCart, color: "bg-violet-50 text-violet-700 border-violet-200" },
  "Accounts":     { icon: Wallet,       color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  "QC":           { icon: ThermometerSun, color: "bg-rose-50 text-rose-700 border-rose-200" },
  "Dispatch":     { icon: Plane,        color: "bg-teal-50 text-teal-700 border-teal-200" },
  "Config":       { icon: Settings,     color: "bg-gray-100 text-gray-700 border-gray-200" },
  "Users":        { icon: UserCog,      color: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200" },
  "Assets":       { icon: Boxes,        color: "bg-cyan-50 text-cyan-700 border-cyan-200" },
};

const ACTION_META: Record<ActionKind, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  "Create":  { icon: Plus,      color: "text-emerald-700" },
  "Update":  { icon: Pencil,    color: "text-blue-700" },
  "Delete":  { icon: Trash2,    color: "text-destructive" },
  "Approve": { icon: Check,     color: "text-emerald-700" },
  "Reject":  { icon: X,         color: "text-destructive" },
  "View":    { icon: Eye,       color: "text-slate-600" },
  "Login":   { icon: LogIn,     color: "text-sky-700" },
  "Logout":  { icon: LogOut,    color: "text-slate-600" },
  "Export":  { icon: Download,  color: "text-violet-700" },
  "Import":  { icon: Upload,    color: "text-indigo-700" },
  "Print":   { icon: Printer,   color: "text-slate-600" },
  "Lock":    { icon: Lock,      color: "text-amber-700" },
};

const SEVERITY_DOT: Record<Severity, string> = {
  info:     "bg-sky-500",
  success:  "bg-emerald-500",
  warning:  "bg-amber-500",
  critical: "bg-destructive",
};

const SEVERITY_BADGE: Record<Severity, string> = {
  info:     "bg-sky-50 text-sky-700 border-sky-200",
  success:  "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning:  "bg-amber-50 text-amber-700 border-amber-200",
  critical: "bg-destructive/10 text-destructive border-destructive/20",
};

// ── Seed data ─────────────────────────────────────────────────────────────

const LOGS: AuditEvent[] = [
  {
    id: "LG-9032", at: "2026-05-24 09:42:11", user: "r.hossain", userRole: "Business Analyst",
    module: "Procurement", action: "Approve", description: "Approved purchase order to Padma Foods Ltd.",
    target: "PO-2025-0451", targetType: "Purchase Order",
    ip: "10.0.4.10", device: "Chrome 132 · Windows",
    result: "Success", severity: "success",
    changes: [{ field: "status", before: "Pending Approval", after: "Approved" }],
  },
  {
    id: "LG-9031", at: "2026-05-24 09:38:54", user: "qc.fb", userRole: "QC Officer",
    module: "QC", action: "Reject", description: "QC Failed · Visual Inspection out of spec",
    target: "PRD-9006 / BS-225", targetType: "Production Batch",
    ip: "10.0.4.21", device: "Chrome 132 · Windows",
    result: "Success", severity: "critical",
    changes: [{ field: "qc_result", before: "Pending", after: "Fail" }],
  },
  {
    id: "LG-9030", at: "2026-05-24 09:31:02", user: "store.adm", userRole: "Store Manager",
    module: "Inventory", action: "Create", description: "Opening stock recorded for Basmati Rice",
    target: "ITM-001 / OB-2026-001", targetType: "Opening Batch",
    ip: "10.0.4.55", device: "Chrome 132 · Windows",
    result: "Success", severity: "info",
  },
  {
    id: "LG-9029", at: "2026-05-24 09:27:18", user: "store.adm", userRole: "Store Manager",
    module: "Inventory", action: "Update", description: "Switched allocation method to FEFO",
    target: "ITM-005 / All-Purpose Flour", targetType: "Item Master",
    ip: "10.0.4.55", device: "Chrome 132 · Windows",
    result: "Success", severity: "info",
    changes: [{ field: "allocationMethod", before: "FIFO", after: "FEFO" }],
  },
  {
    id: "LG-9028", at: "2026-05-24 09:22:46", user: "ops.user", userRole: "Operations",
    module: "Orders", action: "Import", description: "Flight manifest imported for BS-203 DAC→DOH",
    target: "BS-203 / ORD-3416", targetType: "Flight Order",
    ip: "10.0.4.12", device: "Chrome 132 · Windows",
    result: "Success", severity: "success",
  },
  {
    id: "LG-9027", at: "2026-05-24 09:18:00", user: "kit.akhan", userRole: "Kitchen Lead",
    module: "Production", action: "Create", description: "Production batch started for Chicken Biryani",
    target: "PRD-9003", targetType: "Production Order",
    ip: "10.0.4.45", device: "iPad Safari · Kitchen Floor",
    result: "Success", severity: "info",
  },
  {
    id: "LG-9026", at: "2026-05-24 09:15:33", user: "fin.admin", userRole: "Finance",
    module: "Accounts", action: "Approve", description: "Invoice payment cleared for vendor Padma Foods",
    target: "INV-2026-0184 / ৳2,45,000", targetType: "Invoice",
    ip: "10.0.4.18", device: "Chrome 132 · macOS",
    result: "Success", severity: "success",
  },
  {
    id: "LG-9025", at: "2026-05-24 09:10:12", user: "unknown", userRole: "—",
    module: "Auth", action: "Login", description: "Failed login attempt · invalid credentials (3rd attempt)",
    target: "ops.user", targetType: "User Account",
    ip: "203.122.45.87", device: "Unknown · External",
    result: "Failure", severity: "critical",
  },
  {
    id: "LG-9024", at: "2026-05-24 09:05:44", user: "r.hossain", userRole: "Business Analyst",
    module: "Users", action: "Create", description: "Created new user account",
    target: "U-014 / hassan.m", targetType: "User",
    ip: "10.0.4.10", device: "Chrome 132 · Windows",
    result: "Success", severity: "info",
  },
  {
    id: "LG-9023", at: "2026-05-24 08:58:21", user: "store.adm", userRole: "Store Manager",
    module: "Inventory", action: "Update", description: "Low Stock alert raised · auto-PR triggered",
    target: "INV-1005 / Cooking Oil", targetType: "Stock Alert",
    ip: "10.0.4.55", device: "Chrome 132 · Windows",
    result: "Success", severity: "warning",
  },
  {
    id: "LG-9022", at: "2026-05-24 08:50:09", user: "ops.user", userRole: "Operations",
    module: "Menu Planning", action: "Update", description: "Updated meal choices for BS-307 international",
    target: "MP-2026-0044 / BS-307", targetType: "Menu Plan",
    ip: "10.0.4.12", device: "Chrome 132 · Windows",
    result: "Success", severity: "info",
    changes: [
      { field: "veg_choice", before: "Paneer Tikka", after: "Paneer Butter Masala" },
      { field: "dessert", before: "Rasmalai", after: "Gulab Jamun" },
    ],
  },
  {
    id: "LG-9021", at: "2026-05-24 08:42:55", user: "fin.admin", userRole: "Finance",
    module: "Procurement", action: "Reject", description: "Purchase requisition rejected · over budget",
    target: "PR-2026-0312", targetType: "Purchase Requisition",
    ip: "10.0.4.18", device: "Chrome 132 · macOS",
    result: "Success", severity: "warning",
    changes: [{ field: "status", before: "Pending Accounts", after: "Rejected" }],
  },
  {
    id: "LG-9020", at: "2026-05-24 08:35:18", user: "store.adm", userRole: "Store Manager",
    module: "Inventory", action: "Create", description: "GRN received against PO-2025-0450",
    target: "GRN-2026-0098 / PO-2025-0450", targetType: "Goods Receipt",
    ip: "10.0.4.55", device: "Chrome 132 · Windows",
    result: "Success", severity: "success",
  },
  {
    id: "LG-9019", at: "2026-05-24 08:28:42", user: "qc.fb", userRole: "QC Officer",
    module: "QC", action: "Create", description: "Hygiene inspection logged for Cold Kitchen",
    target: "HYG-2026-0167", targetType: "Hygiene Check",
    ip: "10.0.4.21", device: "iPad Safari · Floor",
    result: "Success", severity: "info",
  },
  {
    id: "LG-9018", at: "2026-05-24 08:20:00", user: "disp.lead", userRole: "Dispatch Lead",
    module: "Dispatch", action: "Update", description: "Dispatch DSP-2026-0078 marked En Route",
    target: "DSP-2026-0078 / BS-141", targetType: "Dispatch",
    ip: "10.0.4.33", device: "Android · Handheld",
    result: "Success", severity: "info",
    changes: [{ field: "status", before: "Loaded", after: "En Route" }],
  },
  {
    id: "LG-9017", at: "2026-05-24 08:12:31", user: "r.hossain", userRole: "Business Analyst",
    module: "Config", action: "Update", description: "Updated approval matrix · added second approver above ৳1L",
    target: "Approval Matrix / PR", targetType: "Configuration",
    ip: "10.0.4.10", device: "Chrome 132 · Windows",
    result: "Success", severity: "warning",
    changes: [{ field: "second_approver_threshold", before: "৳200,000", after: "৳100,000" }],
  },
  {
    id: "LG-9016", at: "2026-05-24 08:05:17", user: "ops.user", userRole: "Operations",
    module: "Orders", action: "Export", description: "Exported active flight orders to CSV",
    target: "ORD-export-2026-05-24-08.csv", targetType: "Export",
    ip: "10.0.4.12", device: "Chrome 132 · Windows",
    result: "Success", severity: "info",
  },
  {
    id: "LG-9015", at: "2026-05-24 07:58:09", user: "store.adm", userRole: "Store Manager",
    module: "Inventory", action: "Delete", description: "Removed expired batch lot",
    target: "ITM-022 / B-2025-1109", targetType: "Batch Lot",
    ip: "10.0.4.55", device: "Chrome 132 · Windows",
    result: "Success", severity: "warning",
    changes: [{ field: "stock", before: "12 Kg", after: "0 Kg (discarded)" }],
  },
  {
    id: "LG-9014", at: "2026-05-24 07:50:44", user: "kit.akhan", userRole: "Kitchen Lead",
    module: "Production", action: "Update", description: "Production batch closed · 480 portions packed",
    target: "PRD-9001 / BS-203", targetType: "Production Batch",
    ip: "10.0.4.45", device: "iPad Safari · Kitchen",
    result: "Success", severity: "success",
  },
  {
    id: "LG-9013", at: "2026-05-24 07:42:20", user: "r.hossain", userRole: "Business Analyst",
    module: "Auth", action: "Login", description: "Signed in",
    target: "r.hossain", targetType: "Session",
    ip: "10.0.4.10", device: "Chrome 132 · Windows",
    result: "Success", severity: "info",
  },
  {
    id: "LG-9012", at: "2026-05-23 21:18:55", user: "night.ops", userRole: "Night Shift",
    module: "Auth", action: "Lock", description: "Account locked · 5 failed login attempts",
    target: "kit.junior", targetType: "User Account",
    ip: "10.0.4.71", device: "Unknown · LAN",
    result: "Success", severity: "critical",
  },
  {
    id: "LG-9011", at: "2026-05-23 20:42:08", user: "qc.fb", userRole: "QC Officer",
    module: "QC", action: "Create", description: "Cooking temperature outside threshold (recorded as exception)",
    target: "CT-2026-0455", targetType: "Cooking Temp Log",
    ip: "10.0.4.21", device: "iPad Safari · Floor",
    result: "Success", severity: "warning",
    changes: [{ field: "core_temp", before: "—", after: "68°C (limit ≥70°C)" }],
  },
  {
    id: "LG-9010", at: "2026-05-23 19:30:12", user: "store.adm", userRole: "Store Manager",
    module: "Inventory", action: "Import", description: "Bulk uploaded 24 new items (CSV)",
    target: "item-bulk-2026-05-23.csv", targetType: "Bulk Import",
    ip: "10.0.4.55", device: "Chrome 132 · Windows",
    result: "Success", severity: "success",
  },
  {
    id: "LG-9009", at: "2026-05-23 18:14:39", user: "ops.user", userRole: "Operations",
    module: "Orders", action: "View", description: "Viewed GM Order Details modal",
    target: "ORD-3412 / BG-522 DAC→LHR", targetType: "Flight Order",
    ip: "10.0.4.12", device: "Chrome 132 · Windows",
    result: "Success", severity: "info",
  },
  {
    id: "LG-9008", at: "2026-05-23 17:48:05", user: "r.hossain", userRole: "Business Analyst",
    module: "Users", action: "Update", description: "Role changed for hassan.m",
    target: "U-014 / hassan.m", targetType: "User",
    ip: "10.0.4.10", device: "Chrome 132 · Windows",
    result: "Success", severity: "warning",
    changes: [{ field: "role", before: "Store Manager", after: "Procurement Manager" }],
  },
  {
    id: "LG-9007", at: "2026-05-23 17:22:48", user: "disp.lead", userRole: "Dispatch Lead",
    module: "Dispatch", action: "Print", description: "Printed dispatch manifest for BS-307",
    target: "DSP-2026-0076 / BS-307", targetType: "Dispatch Manifest",
    ip: "10.0.4.33", device: "Android · Handheld",
    result: "Success", severity: "info",
  },
  {
    id: "LG-9006", at: "2026-05-23 16:55:30", user: "fin.admin", userRole: "Finance",
    module: "Accounts", action: "Reject", description: "Expense entry rejected · missing GL code",
    target: "EXP-2026-0091", targetType: "Expense",
    ip: "10.0.4.18", device: "Chrome 132 · macOS",
    result: "Success", severity: "warning",
  },
  {
    id: "LG-9005", at: "2026-05-23 15:30:14", user: "ops.user", userRole: "Operations",
    module: "Menu Planning", action: "Create", description: "Created weekly menu cycle (week 22)",
    target: "MP-W22-2026", targetType: "Menu Cycle",
    ip: "10.0.4.12", device: "Chrome 132 · Windows",
    result: "Success", severity: "info",
  },
  {
    id: "LG-9004", at: "2026-05-23 14:08:22", user: "store.adm", userRole: "Store Manager",
    module: "Inventory", action: "Update", description: "Stock adjustment · variance after physical count",
    target: "ITM-018 / Eggs", targetType: "Stock Adjustment",
    ip: "10.0.4.55", device: "Chrome 132 · Windows",
    result: "Success", severity: "warning",
    changes: [{ field: "stock", before: "1,440 Pcs", after: "1,392 Pcs (−48)" }],
  },
  {
    id: "LG-9003", at: "2026-05-23 12:55:01", user: "admin", userRole: "System Admin",
    module: "Config", action: "Update", description: "Updated company GST registration",
    target: "Company Profile", targetType: "Configuration",
    ip: "10.0.4.10", device: "Chrome 132 · Windows",
    result: "Success", severity: "info",
  },
  {
    id: "LG-9002", at: "2026-05-23 11:40:48", user: "fin.admin", userRole: "Finance",
    module: "Procurement", action: "Approve", description: "Approved RFQ award to lowest bidder",
    target: "RFQ-2026-0078 / Vendor: Padma Foods", targetType: "RFQ Award",
    ip: "10.0.4.18", device: "Chrome 132 · macOS",
    result: "Success", severity: "success",
  },
  {
    id: "LG-9001", at: "2026-05-23 10:15:12", user: "r.hossain", userRole: "Business Analyst",
    module: "Auth", action: "Logout", description: "Session ended",
    target: "r.hossain", targetType: "Session",
    ip: "10.0.4.10", device: "Chrome 132 · Windows",
    result: "Success", severity: "info",
  },
];

const MODULE_OPTIONS: (Module | "All")[] = [
  "All", "Auth", "Orders", "Menu Planning", "Production",
  "Inventory", "Procurement", "Accounts", "QC", "Dispatch", "Config", "Users", "Assets",
];

// ── Live audit events → page shape ────────────────────────────────────────
// Real events emitted by modules (lib/audit-log) carry free-text module/action
// strings. Map them onto the page's fixed taxonomies so they render with the
// same icons/badges and merge cleanly with the historical seed.

function mapModule(m: string): Module {
  const k = m.toLowerCase();
  if (k.includes("procure") || k.includes("purchase")) return "Procurement";
  if (k.includes("quality") || k === "qc") return "QC";
  if (k.includes("dispatch") || k.includes("galley")) return "Dispatch";
  if (k.includes("order")) return "Orders";
  if (k.includes("menu")) return "Menu Planning";
  if (k.includes("production")) return "Production";
  if (k.includes("account") || k.includes("billing")) return "Accounts";
  if (k.includes("asset") || k.includes("equipment")) return "Assets";
  if (k.includes("user")) return "Users";
  if (k.includes("config")) return "Config";
  if (k.includes("stock") || k.includes("inventory") || k.includes("transfer") || k.includes("issue")) return "Inventory";
  return "Inventory";
}

function mapAction(a: string): { action: ActionKind; severity: Severity } {
  const k = a.toLowerCase();
  if (/reject|fail|decline/.test(k)) return { action: "Reject", severity: "warning" };
  if (/approv/.test(k)) return { action: "Approve", severity: "success" };
  if (/delet|dispos|destroy|write.?off|scrap/.test(k)) return { action: "Delete", severity: "warning" };
  if (/creat|generat|raise|new|register|receiv|post|issue/.test(k)) return { action: "Create", severity: "success" };
  return { action: "Update", severity: "info" };
}

function toPageEvent(e: LiveAuditEvent): AuditEvent {
  const { action, severity } = mapAction(e.action);
  const at = e.ts.replace("T", " ").slice(0, 19);
  return {
    id: e.id,
    at,
    user: e.actor,
    userRole: "—",
    module: mapModule(e.module),
    action,
    description: e.detail ? `${e.action} — ${e.detail}` : e.action,
    target: e.entity,
    targetType: e.module,
    ip: "—",
    device: "In-app",
    result: "Success",
    severity,
  };
}

const ACTION_OPTIONS: (ActionKind | "All")[] = [
  "All", "Create", "Update", "Delete", "Approve", "Reject", "View",
  "Login", "Logout", "Export", "Import", "Print", "Lock",
];

const SEVERITY_OPTIONS: (Severity | "All")[] = ["All", "info", "success", "warning", "critical"];

const selectCls =
  "h-9 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

// ── Helpers ───────────────────────────────────────────────────────────────

// ── Target deep-links ─────────────────────────────────────────────────────
// An audit target names a real record, so its id opens the page that owns it
// with the row blinking (the same arrival-flash other modules link with). The
// route is resolved from the record TYPE first — ids alone are ambiguous
// (INV-2026-0184 is an invoice, INV-1005 a stock alert) — then the id prefix.

// ONLY pages that run `useArrivalFlash()` are linked — anywhere else the row
// could never blink, so the id stays plain text rather than promising a jump
// that does nothing.
const TYPE_ROUTES: { test: RegExp; path: string; flash: string }[] = [
  { test: /purchase order/,                      path: "/procurement",          flash: "po-list" },
  { test: /purchase requisition/,                path: "/purchase-requisition", flash: "pr-list" },
  { test: /goods receipt/,                       path: "/receive-item",         flash: "grn-list" },
  { test: /packaging/,                           path: "/packaging",            flash: "packaging-list" },
  { test: /production/,                          path: "/production-entry",     flash: "production-list" },
  { test: /dispatch/,                            path: "/dispatch",             flash: "dispatch-list" },
  { test: /cooking temp/,                        path: "/cooking-temp",         flash: "cooking-temp-list" },
  { test: /stock (alert|adjustment)/,            path: "/inventory",            flash: "inv-alerts" },
  { test: /item master|batch lot|opening batch/, path: "/inventory",            flash: "inv-alerts" },
  { test: /flight order|order/,                  path: "/order-management",     flash: "active-orders" },
  { test: /transfer/,                            path: "/transfer",             flash: "transfer-list" },
];

/** Pages that accept a deep-link id on the query string (used to page-jump the
 *  destination table so the row exists for the flash to find). */
const DEEP_PARAM: Record<string, string> = {
  "/production-entry": "pro",
  "/order-management": "ord",
};

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`harvest-data-v1:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The row ids to blink on the destination. Usually the target id itself, but two
 * pages key their rows differently from what the audit entry records:
 *  • Packaging blinks by the batch's PRODUCTION id, not the CT- batch id.
 *  • Order Management blinks per LEG (FO-…), not by the ORD- order number.
 */
function flashIdsFor(path: string, id: string): string[] {
  if (path === "/packaging" && /^CT-/i.test(id)) {
    const batch = readStore<Array<{ id: string; batch: string }>>("packaging-batches", [])
      .find((b) => b.id === id);
    return batch ? [batch.batch, id] : [id];
  }
  if (path === "/order-management" && /^ORD-/i.test(id)) {
    const legs = getFlightOrders().filter((o) => o.orderNo === id).map((o) => o.id);
    return legs.length > 0 ? legs : [id];
  }
  return [id];
}

function routeForTarget(targetType: string, id: string): { path: string; flash: string; ids: string[] } | null {
  const t = (targetType ?? "").toLowerCase();
  const hit = TYPE_ROUTES.find((r) => r.test.test(t));
  if (!hit) return null;
  const param = DEEP_PARAM[hit.path];
  return {
    path: param ? `${hit.path}?${param}=${encodeURIComponent(id)}` : hit.path,
    flash: hit.flash,
    ids: flashIdsFor(hit.path, id),
  };
}

/** A target can name more than one record ("PRD-9006 / BS-225"). Tokens that
 *  look like a record id become links; free text (names, amounts) stays plain. */
const isRecordId = (s: string) => /^[A-Za-z]{1,5}-[A-Za-z0-9][\w-]*$/.test(s) && /\d/.test(s);

function TargetLinks({ target, targetType }: { target: string; targetType: string }) {
  const navigate = useNavigate();
  const parts = (target ?? "").split("/").map((p) => p.trim()).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        const route = isRecordId(part) ? routeForTarget(targetType, part) : null;
        return (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground"> / </span>}
            {route ? (
              <button
                type="button"
                className="text-primary font-semibold hover:underline focus:outline-none focus:underline"
                title={`Open in ${route.path.split("?")[0].replace("/", "").replace(/-/g, " ")}`}
                onClick={(e) => {
                  e.stopPropagation();
                  flagArrival({ target: route.flash, ids: route.ids });
                  navigate(route.path);
                }}
              >
                {part}
              </button>
            ) : (
              part
            )}
          </span>
        );
      })}
    </>
  );
}

// ── Plain-language summary ────────────────────────────────────────────────
// A one-line, non-technical retelling of the entry for the drill-down, e.g.
// "R. Hossain Created Production Order (PRO-2026-030342) at 12:07:10 on
//  2026-07-22 from WEB/APP".

const ACTION_VERB: Record<ActionKind, string> = {
  "Create": "Created", "Update": "Updated", "Delete": "Deleted",
  "Approve": "Approved", "Reject": "Rejected", "View": "Viewed",
  "Login": "Signed In To", "Logout": "Signed Out Of", "Export": "Exported",
  "Import": "Imported", "Print": "Printed", "Lock": "Locked",
};

/** Where the action came from, in words a non-technical reader expects. */
const originLabel = (device: string) => {
  const d = (device ?? "").trim();
  if (!d || d === "—") return "APP";
  if (/in-app/i.test(d)) return "APP";
  return d;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Split a stored "YYYY-MM-DD HH:MM:SS" stamp into its date (with weekday) and a
 *  12-hour time with AM/PM — { date: "2026-07-22 (Wed)", time: "12:08:19 PM" }. */
function splitStamp(at: string): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(at ?? "");
  if (!m) return { date: at ?? "", time: "" };
  const [, date, hhRaw, mm, ss] = m;
  const hh = Number(hhRaw);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const d = new Date(`${date}T00:00:00`);
  const day = isNaN(d.getTime()) ? "" : DAY_NAMES[d.getDay()];
  return {
    date: day ? `${date} (${day})` : date,
    time: `${String(h12).padStart(2, "0")}:${mm}${ss ? `:${ss}` : ""} ${hh >= 12 ? "PM" : "AM"}`,
  };
}

/** Full stamp with weekday on a 12-hour clock — "2026-07-22 (Wed) 12:08:19 PM". */
function stamp12h(at: string): string {
  const s = splitStamp(at);
  return s.time ? `${s.date} ${s.time}` : (at ?? "");
}

function relativeTime(at: string, now: Date): string {
  const t = new Date(at.replace(" ", "T")).getTime();
  const diff = now.getTime() - t;
  if (isNaN(diff)) return at;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function Audit() {
  const now = useMemo(() => new Date(), []);
  const [moduleFilter, setModuleFilter] = useState<Module | "All">("All");
  const [actionFilter, setActionFilter] = useState<ActionKind | "All">("All");
  const [severityFilter, setSeverityFilter] = useState<Severity | "All">("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  // Real events recorded by modules (newest-first) prepended to the historical
  // seed, so the trail is live rather than static mock rows.
  const allLogs = useMemo<AuditEvent[]>(
    () => [...getAuditEvents().map(toPageEvent), ...LOGS],
    [],
  );

  const filtered = useMemo(() => {
    return allLogs.filter((l) => {
      if (moduleFilter !== "All" && l.module !== moduleFilter) return false;
      if (actionFilter !== "All" && l.action !== actionFilter) return false;
      if (severityFilter !== "All" && l.severity !== severityFilter) return false;
      if (dateFrom && l.at.slice(0, 10) < dateFrom) return false;
      if (dateTo && l.at.slice(0, 10) > dateTo) return false;
      return true;
    });
  }, [allLogs, moduleFilter, actionFilter, severityFilter, dateFrom, dateTo]);

  // KPIs derived from the full merged log (not the filtered set)
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = allLogs.filter((l) => l.at.startsWith(today));
  const distinctUsers = new Set(allLogs.map((l) => l.user)).size;
  const criticalEvents = allLogs.filter((l) => l.severity === "critical").length;
  const failedEvents = allLogs.filter((l) => l.result === "Failure").length;

  const resetFilters = () => {
    setModuleFilter("All");
    setActionFilter("All");
    setSeverityFilter("All");
    setDateFrom("");
    setDateTo("");
    toast.success("Filters cleared.");
  };

  const cols: Column<AuditEvent>[] = [
    {
      key: "severity",
      header: "",
      render: (r) => (
        <span
          className={cn("inline-block h-2 w-2 rounded-full", SEVERITY_DOT[r.severity])}
          title={r.severity}
        />
      ),
    },
    {
      key: "user",
      header: "User",
      render: (r) => (
        <div className="leading-tight">
          <div className="text-xs font-medium">{r.user}</div>
          <div className="text-[10px] text-muted-foreground">{r.userRole}</div>
        </div>
      ),
    },
    {
      key: "target",
      header: "Target",
      render: (r) => (
        <div className="leading-tight">
          {/* Ids open the record's own page with the row blinking. */}
          <div className="text-xs font-medium font-mono max-w-[200px] truncate" title={r.target}>
            <TargetLinks target={r.target} targetType={r.targetType} />
          </div>
          <div className="text-[10px] text-muted-foreground">{r.targetType}</div>
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (r) => {
        const a = ACTION_META[r.action];
        const Icon = a.icon;
        return (
          <div className="flex items-start gap-1.5">
            <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", a.color)} />
            <div className="leading-tight">
              <div className={cn("text-xs font-semibold", a.color)}>{r.action}</div>
              <div className="text-[11px] text-muted-foreground truncate max-w-[280px]" title={r.description}>
                {r.description}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: "module",
      header: "Module",
      render: (r) => {
        const m = MODULE_META[r.module];
        const Icon = m.icon;
        return (
          <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold", m.color)}>
            <Icon className="h-3 w-3" />
            {r.module}
          </span>
        );
      },
    },
    {
      key: "at",
      header: "When",
      render: (r) => (
        <div className="leading-tight">
          <div className="text-xs font-medium">{relativeTime(r.at, now)}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">{stamp12h(r.at)}</div>
        </div>
      ),
    },
    {
      key: "result",
      header: "Result",
      render: (r) => (
        <span className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border",
          SEVERITY_BADGE[r.severity],
        )}>
          {r.result === "Success" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {r.result}
        </span>
      ),
    },
    {
      key: "ip",
      header: "Origin",
      render: (r) => (
        <div className="leading-tight">
          <div className="text-[11px] font-mono">{r.ip}</div>
          <div className="text-[10px] text-muted-foreground truncate max-w-[160px]" title={r.device}>{r.device}</div>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit Logs"
        subtitle="Immutable system activity trail · who did what, where, when, and what changed"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <KpiCard label="Events Today" value={todayEvents.length} icon={Activity} tone="navy" />
        <KpiCard label="Active Users" value={distinctUsers} icon={Users} tone="success" />
        <KpiCard label="Critical Events" value={criticalEvents} icon={Shield} tone="red" />
        <KpiCard label="Failed Actions" value={failedEvents} icon={AlertTriangle} tone="warning" />
      </div>

      {/* Filter bar */}
      {/* Filter bar — a heading row, then the fields on their own line so every
          label sits directly above its control and the controls share a baseline. */}
      <div className="rounded-md border border-border bg-card px-4 py-3 mb-4">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <Filter className="h-3.5 w-3.5" /> Filters
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {allLogs.length} events
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Module</Label>
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value as Module | "All")}
              className={cn(selectCls, "w-36")}
            >
              {MODULE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Action</Label>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value as ActionKind | "All")}
              className={cn(selectCls, "w-32")}
            >
              {ACTION_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Severity</Label>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as Severity | "All")}
              className={cn(selectCls, "w-32")}
            >
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>{s === "All" ? "All" : s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 w-36 text-xs tabular-nums"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 w-36 text-xs tabular-nums"
            />
          </div>
          <Button variant="outline" size="sm" onClick={resetFilters} className="h-9">
            <RotateCw className="h-3.5 w-3.5 mr-1" /> Reset
          </Button>
        </div>
      </div>

      <DataTable
        title="audit"
        data={filtered}
        columns={cols}
        searchKeys={["id", "user", "userRole", "action", "description", "target", "ip", "module"]}
        selectable={false}
        actions={(r) => (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setSelected(r)}
          >
            Details
          </Button>
        )}
      />

      <AuditDetailDialog event={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function AuditDetailDialog({
  event, onClose,
}: { event: AuditEvent | null; onClose: () => void }) {
  if (!event) return null;
  const m = MODULE_META[event.module];
  const a = ACTION_META[event.action];
  const ModuleIcon = m.icon;
  const ActionIcon = a.icon;

  return (
    <Dialog open={!!event} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl w-[min(95vw,720px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={cn("inline-block h-2.5 w-2.5 rounded-full", SEVERITY_DOT[event.severity])} />
            {event.id} · {event.action} {event.target}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {event.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Field label="When" mono>{stamp12h(event.at)}</Field>
            <Field label="User">
              <div className="font-semibold">{event.user}</div>
              <div className="text-[11px] text-muted-foreground">{event.userRole}</div>
            </Field>
            <Field label="Module">
              <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold", m.color)}>
                <ModuleIcon className="h-3 w-3" /> {event.module}
              </span>
            </Field>
            <Field label="Action">
              <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", a.color)}>
                <ActionIcon className="h-3.5 w-3.5" /> {event.action}
              </span>
            </Field>
            <Field label="Target" mono>
              <div><TargetLinks target={event.target} targetType={event.targetType} /></div>
              <div className="text-[11px] text-muted-foreground font-sans">{event.targetType}</div>
            </Field>
            <Field label="Result">
              <span className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold border",
                SEVERITY_BADGE[event.severity],
              )}>
                {event.result === "Success"
                  ? <CheckCircle2 className="h-3 w-3" />
                  : <AlertTriangle className="h-3 w-3" />}
                {event.result} · {event.severity}
              </span>
            </Field>
            <Field label="IP Address" mono>
              <div className="flex items-center gap-1.5">
                <Globe className="h-3 w-3 text-muted-foreground" />
                {event.ip}
              </div>
            </Field>
            <Field label="Device">{event.device}</Field>
          </div>

          {event.changes && event.changes.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 flex items-center gap-1">
                <FileText className="h-3 w-3" /> Field Changes
              </div>
              <div className="rounded-md border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold">Field</th>
                      <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold">Before</th>
                      <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider font-semibold">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.changes.map((c, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="px-3 py-1.5 font-mono text-[11px]">{c.field}</td>
                        <td className="px-3 py-1.5 text-destructive line-through">{c.before}</td>
                        <td className="px-3 py-1.5 text-emerald-700 font-medium">{c.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Plain-language retelling of the entry, for non-technical readers. */}
          <div className="rounded-md border border-sky-200 bg-sky-50/70 px-3 py-2.5 text-[13px] leading-relaxed text-slate-700">
            <div className="text-[10px] uppercase tracking-wider text-sky-700 font-semibold mb-1">Summary</div>
            <span className="font-semibold">
              {event.userRole && event.userRole !== "—" ? `${event.userRole} ` : ""}{event.user}
            </span>{" "}
            <span className="font-semibold">{ACTION_VERB[event.action]}</span>{" "}
            {event.targetType}
            {event.target && (
              <>
                {" ("}
                <span className="font-mono text-[12px]">
                  <TargetLinks target={event.target} targetType={event.targetType} />
                </span>
                {")"}
              </>
            )}{" "}
            at <span className="tabular-nums font-medium">{splitStamp(event.at).time || event.at}</span>{" "}
            on <span className="tabular-nums font-medium">{splitStamp(event.at).date}</span>{" "}
            from {originLabel(event.device)}.
            {event.result === "Failure" && <span className="text-destructive font-semibold"> The action did not succeed.</span>}
          </div>

          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-sky-600" />
            <div>
              This entry is immutable. Audit log entries are append-only and cannot be edited or deleted after creation.
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label, children, mono,
}: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={cn("text-sm mt-0.5", mono && "font-mono")}>{children}</div>
    </div>
  );
}

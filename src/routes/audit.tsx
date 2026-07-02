import { useMemo, useState } from "react";
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

// ── Types & taxonomies ────────────────────────────────────────────────────

type Severity = "info" | "success" | "warning" | "critical";

type ActionKind =
  | "Create" | "Update" | "Delete" | "Approve" | "Reject" | "View"
  | "Login" | "Logout" | "Export" | "Import" | "Print" | "Lock";

type Module =
  | "Auth" | "Orders" | "Menu Planning" | "Production" | "Inventory"
  | "Procurement" | "Accounts" | "QC" | "Dispatch" | "Config" | "Users";

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
    id: "LG-9032", at: "2026-05-24 09:42:11", user: "r.hossain", userRole: "GM/Admin",
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
    id: "LG-9024", at: "2026-05-24 09:05:44", user: "r.hossain", userRole: "GM/Admin",
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
    id: "LG-9017", at: "2026-05-24 08:12:31", user: "r.hossain", userRole: "GM/Admin",
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
    id: "LG-9013", at: "2026-05-24 07:42:20", user: "r.hossain", userRole: "GM/Admin",
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
    id: "LG-9008", at: "2026-05-23 17:48:05", user: "r.hossain", userRole: "GM/Admin",
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
    id: "LG-9001", at: "2026-05-23 10:15:12", user: "r.hossain", userRole: "GM/Admin",
    module: "Auth", action: "Logout", description: "Session ended",
    target: "r.hossain", targetType: "Session",
    ip: "10.0.4.10", device: "Chrome 132 · Windows",
    result: "Success", severity: "info",
  },
];

const MODULE_OPTIONS: (Module | "All")[] = [
  "All", "Auth", "Orders", "Menu Planning", "Production",
  "Inventory", "Procurement", "Accounts", "QC", "Dispatch", "Config", "Users",
];

const ACTION_OPTIONS: (ActionKind | "All")[] = [
  "All", "Create", "Update", "Delete", "Approve", "Reject", "View",
  "Login", "Logout", "Export", "Import", "Print", "Lock",
];

const SEVERITY_OPTIONS: (Severity | "All")[] = ["All", "info", "success", "warning", "critical"];

const selectCls =
  "h-9 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

// ── Helpers ───────────────────────────────────────────────────────────────

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
  const now = useMemo(() => new Date("2026-05-24T10:00:00"), []);
  const [moduleFilter, setModuleFilter] = useState<Module | "All">("All");
  const [actionFilter, setActionFilter] = useState<ActionKind | "All">("All");
  const [severityFilter, setSeverityFilter] = useState<Severity | "All">("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const filtered = useMemo(() => {
    return LOGS.filter((l) => {
      if (moduleFilter !== "All" && l.module !== moduleFilter) return false;
      if (actionFilter !== "All" && l.action !== actionFilter) return false;
      if (severityFilter !== "All" && l.severity !== severityFilter) return false;
      if (dateFrom && l.at.slice(0, 10) < dateFrom) return false;
      if (dateTo && l.at.slice(0, 10) > dateTo) return false;
      return true;
    });
  }, [moduleFilter, actionFilter, severityFilter, dateFrom, dateTo]);

  // KPIs derived from full LOGS (not the filtered set)
  const today = "2026-05-24";
  const todayEvents = LOGS.filter((l) => l.at.startsWith(today));
  const distinctUsers = new Set(LOGS.map((l) => l.user)).size;
  const criticalEvents = LOGS.filter((l) => l.severity === "critical").length;
  const failedEvents = LOGS.filter((l) => l.result === "Failure").length;

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
      key: "at",
      header: "When",
      render: (r) => (
        <div className="leading-tight">
          <div className="text-xs font-medium">{relativeTime(r.at, now)}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">{r.at}</div>
        </div>
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
      key: "target",
      header: "Target",
      render: (r) => (
        <div className="leading-tight">
          <div className="text-xs font-medium font-mono truncate max-w-[200px]" title={r.target}>{r.target}</div>
          <div className="text-[10px] text-muted-foreground">{r.targetType}</div>
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
      <div className="rounded-md border border-border bg-card p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-2">
          <Filter className="h-3.5 w-3.5" /> Filters
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Module</Label>
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value as Module | "All")}
            className={cn(selectCls, "w-36 mt-0.5 block")}
          >
            {MODULE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Action</Label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value as ActionKind | "All")}
            className={cn(selectCls, "w-32 mt-0.5 block")}
          >
            {ACTION_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Severity</Label>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as Severity | "All")}
            className={cn(selectCls, "w-32 mt-0.5 block")}
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "All" ? "All" : s[0].toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">From</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 w-36 mt-0.5 text-xs tabular-nums"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 w-36 mt-0.5 text-xs tabular-nums"
          />
        </div>
        <Button variant="outline" size="sm" onClick={resetFilters} className="h-9">
          <RotateCw className="h-3.5 w-3.5 mr-1" /> Reset
        </Button>
        <div className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {LOGS.length} events
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
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setSelected(r)}
          >
            <Eye className="h-3.5 w-3.5 mr-1" /> Details
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
            <Field label="When" mono>{event.at}</Field>
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
              <div>{event.target}</div>
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

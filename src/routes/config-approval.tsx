import { useState } from "react";
import { Dropdown, Button as AntdButton, Select as AntdSelect } from "antd";
import type { MenuProps } from "antd";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useRole } from "@/lib/roles";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Plus, ArrowLeft, Save, GitBranch, Trash2, ArrowRight, Eye, Pencil, Copy,
  ChevronUp, ChevronDown, AlertTriangle, Clock, History, Power, Send,
  MoreHorizontal, Check, UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/*
 * Approval Setup — Configuration → Approval Setup
 * ------------------------------------------------------------------------
 * Authoring surface for configurable, multi-stage approval chains
 * ("Workflows"). This module implements the Workflow *definition* lifecycle
 * (create / validate / draft / publish / edit / clone / activate / audit)
 * against the domain model below. The Workflow *execution* engine (resolving
 * approvers, walking stages, SLA timers, notification delivery) is a separate
 * runtime concern and is intentionally out of scope here — the model is kept
 * faithful so an engine can execute against it later.
 */

// ── Domain model ─────────────────────────────────────────────────────────────

type TriggerModule =
  | "PURCHASE_REQUISITION" | "PURCHASE_ORDER" | "GOODS_RECEIPT" | "STOCK_ADJUSTMENT"
  | "DEMAND_REQUEST" | "ITEM_ISSUE" | "INVOICE_PAYMENT" | "WASTAGE_DISPOSAL"
  | "STOCK_TRANSFER" | "CONSUMABLE_RETURN";

type ConditionOperator = "EQ" | "NEQ" | "GT" | "GTE" | "LT" | "LTE" | "IN" | "NOT_IN" | "CONTAINS";

interface RuleCondition {
  id: string;
  field: string;
  operator: ConditionOperator;
  value: string; // comma-separated for IN / NOT_IN
}

interface ScopeFilter {
  departments: string[];
  locations: string[];
}

// Approver is resolved from a catering user type, named user(s), or a committee.
type ApproverSource = "USER_TYPE" | "SPECIFIC_USER" | "COMMITTEE";

type ApprovalRule = "ANY_ONE" | "ALL_REQUIRED" | "MAJORITY";

type EscalationAction = "NOTIFY_ONLY" | "ESCALATE_NEXT" | "AUTO_APPROVE" | "AUTO_REJECT" | "REASSIGN_GM";

type NotifyChannel = "IN_APP" | "EMAIL" | "SMS";

interface ApproverConfig {
  source: ApproverSource;
  roleId?: string;   // USER_TYPE — the catering user type
  userIds?: string[]; // SPECIFIC_USER / COMMITTEE
  quorum?: number;    // COMMITTEE — minimum approvals regardless of ApprovalRule
}

interface StageNotify {
  initiator: boolean;
  approvers: boolean;
  gm: boolean;
  customRoleIds: string[];
  channels: NotifyChannel[];
}

interface WorkflowStage {
  id: string;
  name: string;
  approver: ApproverConfig;
  rule: ApprovalRule;
  slaHours: number;
  onSlaBreach: EscalationAction;
  allowDelegate: boolean;
  requireRejectComment: boolean;
  skipConditions: RuleCondition[];
  notify: StageNotify;
}

type AuditAction =
  | "Created" | "Updated" | "Activated" | "Deactivated" | "Cloned"
  | "Stage Added" | "Stage Removed" | "Stage Reordered" | "Published";

interface AuditChange { field: string; from: string; to: string; }

interface AuditEntry {
  id: string;
  action: AuditAction;
  actor: string;
  timestamp: string;
  changes?: AuditChange[];
  note?: string;
}

type WorkflowStatus = "Draft" | "Active" | "Inactive";

interface Workflow {
  id: string;
  name: string;
  code: string;
  description: string;
  module: TriggerModule;
  scope: ScopeFilter;
  conditions: RuleCondition[];
  stages: WorkflowStage[];
  status: WorkflowStatus;
  runCount: number;
  lastRunAt?: string;
  createdBy: string;
  createdAt: string;
  modifiedBy: string;
  updatedAt: string;
  auditLog: AuditEntry[];
}

// ── Option catalogs ──────────────────────────────────────────────────────────

const MODULES: { value: TriggerModule; label: string }[] = [
  { value: "PURCHASE_REQUISITION", label: "Purchase Requisition" },
  { value: "PURCHASE_ORDER",       label: "Purchase Order" },
  { value: "GOODS_RECEIPT",        label: "Goods Receipt" },
  { value: "STOCK_ADJUSTMENT",     label: "Stock Adjustment" },
  { value: "DEMAND_REQUEST",       label: "Demand Request" },
  { value: "ITEM_ISSUE",           label: "Item Issue" },
  { value: "INVOICE_PAYMENT",      label: "Invoice Payment" },
  { value: "WASTAGE_DISPOSAL",     label: "Wastage Disposal" },
  { value: "STOCK_TRANSFER",       label: "Stock Transfer" },
  { value: "CONSUMABLE_RETURN",    label: "Consumable Return" },
];
const moduleLabel = (m: TriggerModule) => MODULES.find((x) => x.value === m)?.label ?? m;

const APPROVER_SOURCES: { value: ApproverSource; label: string }[] = [
  { value: "USER_TYPE",     label: "User Type" },
  { value: "SPECIFIC_USER", label: "Specific User(s)" },
  { value: "COMMITTEE",     label: "Committee" },
];
const sourceLabel = (s: ApproverSource) => APPROVER_SOURCES.find((x) => x.value === s)?.label ?? s;
/** Sources that resolve to more than one person → ApprovalRule is meaningful. */
const MULTI_PERSON_SOURCES: ApproverSource[] = ["USER_TYPE", "SPECIFIC_USER", "COMMITTEE"];

const APPROVAL_RULES: { value: ApprovalRule; label: string }[] = [
  { value: "ANY_ONE",      label: "Any one can approve" },
  { value: "ALL_REQUIRED", label: "All must approve" },
  { value: "MAJORITY",     label: "Majority must approve" },
];

const ESCALATION_ACTIONS: { value: EscalationAction; label: string }[] = [
  { value: "NOTIFY_ONLY",   label: "Notify approver only" },
  { value: "ESCALATE_NEXT", label: "Escalate to next stage" },
  { value: "AUTO_APPROVE",  label: "Auto-approve & continue" },
  { value: "AUTO_REJECT",   label: "Auto-reject request" },
  { value: "REASSIGN_GM",   label: "Reassign to GM" },
];
// Plain-language description shown under the escalation picker.
const ESCALATION_DESC: Record<EscalationAction, string> = {
  NOTIFY_ONLY:   "Send a reminder to the approver. The request stays parked at this stage.",
  ESCALATE_NEXT: "Move the request on to the next approver automatically.",
  AUTO_APPROVE:  "Treat this stage as approved and continue.",
  AUTO_REJECT:   "Reject the request automatically.",
  REASSIGN_GM:   "Hand the pending decision to the GM.",
};
// One-line helper shown under the approver-source picker.
const SOURCE_HELP: Record<ApproverSource, string> = {
  USER_TYPE:     "Resolves to whoever holds this user type in the catering system at runtime.",
  SPECIFIC_USER: "Routes to the exact user(s) you choose below.",
  COMMITTEE:     "A group decides together, subject to the quorum you set below.",
};

const NOTIFY_CHANNELS: { value: NotifyChannel; label: string }[] = [
  { value: "IN_APP", label: "In-App" },
  { value: "EMAIL",  label: "Email" },
  { value: "SMS",    label: "SMS" },
];

const OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: "EQ",       label: "=" },
  { value: "NEQ",      label: "≠" },
  { value: "GT",       label: ">" },
  { value: "GTE",      label: "≥" },
  { value: "LT",       label: "<" },
  { value: "LTE",      label: "≤" },
  { value: "IN",       label: "in" },
  { value: "NOT_IN",   label: "not in" },
  { value: "CONTAINS", label: "contains" },
];
const opLabel = (o: ConditionOperator) => OPERATORS.find((x) => x.value === o)?.label ?? o;

const CONDITION_FIELDS = ["amount", "quantity", "days", "department", "location", "category", "itemType", "priority"];

const SCOPE_DEPARTMENTS = ["Procurement", "Production", "Store & Inventory", "Food Safety & QC", "Airport Store", "Packaging & Dispatch", "Admin"];
const SCOPE_LOCATIONS   = ["Head Office Dhaka", "Central Warehouse", "Regional Warehouse CXB", "Hot Kitchen", "Cold Kitchen"];

// Catering system user types. GM sits at the top of the approval hierarchy (Admin / Head).
const USER_TYPES = [
  "GM - General Manager",
  "System Admin",
  "Executive - Food Safety and QC",
  "Executive - Procurement",
  "Executive - Production",
  "Executive - Store and Inventory",
  "Executive - Food Safety and Hygiene",
  "Executive - Airport Store",
  "Executive - Packaging and Dispatch",
];
const GM_USER_TYPE = USER_TYPES[0];
const USERS = ["S. Ahmed", "K. Rahman", "F. Begum", "H. Uddin", "Md. Karim", "R. Chowdhury", "A. Haque", "S. Nahar", "R. Hossain", "M. Alam", "T. Rahman"];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

// ── Factories & helpers ──────────────────────────────────────────────────────

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;

function nowStamp(): string {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`;
}

function deriveCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) return words[0].slice(0, 5).toUpperCase();
  return words.map((w) => w[0]).join("").toUpperCase().slice(0, 6);
}

const blankCondition = (): RuleCondition => ({ id: uid("CND"), field: "amount", operator: "GTE", value: "" });

const blankStage = (): WorkflowStage => ({
  id: uid("ST"),
  name: "",
  approver: { source: "USER_TYPE", roleId: USER_TYPES[0] },
  rule: "ANY_ONE",
  slaHours: 48,
  onSlaBreach: "NOTIFY_ONLY",
  allowDelegate: false,
  requireRejectComment: true,
  skipConditions: [],
  notify: { initiator: true, approvers: true, gm: false, customRoleIds: [], channels: ["IN_APP"] },
});

const blankWorkflow = (id: string, actor: string): Workflow => ({
  id, name: "", code: "", description: "",
  module: MODULES[0].value,
  scope: { departments: [], locations: [] },
  conditions: [],
  stages: [blankStage()],
  status: "Draft",
  runCount: 0,
  createdBy: actor, createdAt: nowStamp(),
  modifiedBy: actor, updatedAt: nowStamp(),
  auditLog: [],
});

// Deep-ish clone that regenerates all volatile ids (stages / conditions).
function reidStages(stages: WorkflowStage[]): WorkflowStage[] {
  return stages.map((s) => ({
    ...s,
    id: uid("ST"),
    skipConditions: s.skipConditions.map((c) => ({ ...c, id: uid("CND") })),
    approver: { ...s.approver, userIds: s.approver.userIds ? [...s.approver.userIds] : undefined },
    notify: { ...s.notify, customRoleIds: [...s.notify.customRoleIds], channels: [...s.notify.channels] },
  }));
}

const genWorkflowId = (rows: Workflow[]): string => {
  const max = rows.reduce((m, r) => {
    const n = parseInt(r.id.replace(/\D/g, ""), 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 100);
  return `WF-${String(max + 1).padStart(4, "0")}`;
};

const scopeSummary = (s: ScopeFilter): string => {
  const parts: string[] = [];
  if (s.departments.length) parts.push(`Dept: ${s.departments.join("/")}`);
  if (s.locations.length) parts.push(`Loc: ${s.locations.join("/")}`);
  return parts.length ? parts.join(" · ") : "All (no scope filter)";
};

const condText = (c: RuleCondition) => `${c.field} ${opLabel(c.operator)} ${c.value || "—"}`;
const condsSummary = (cs: RuleCondition[]) => (cs.length ? cs.map(condText).join(" AND ") : "—");

const approverText = (a: ApproverConfig): string => {
  switch (a.source) {
    case "USER_TYPE":     return a.roleId ?? "—";
    case "SPECIFIC_USER": return `User(s): ${(a.userIds ?? []).join(", ") || "—"}`;
    case "COMMITTEE":     return `Committee (${(a.userIds ?? []).length} members, quorum ${a.quorum ?? 1})`;
    default:              return sourceLabel(a.source);
  }
};

// Short approver label used in the plain-language flow line.
const approverShort = (a: ApproverConfig): string => {
  if (a.source === "COMMITTEE") return "Committee";
  if (a.source === "SPECIFIC_USER") return "Selected user(s)";
  return a.roleId ?? "Approver";
};

// Human-readable "Requester Initiates → X Approves → GM Approves" line.
const flowText = (stages: WorkflowStage[]): string => {
  if (stages.length === 0) return "Requester Initiates → (no stages yet)";
  const parts = ["Requester Initiates"];
  stages.forEach((s) => {
    parts.push(`${approverShort(s.approver)} ${s.approver.source === "COMMITTEE" ? "Decides" : "Approves"}`);
  });
  return parts.join(" → ");
};

// ── Starter templates ────────────────────────────────────────────────────────

const TEMPLATES: { key: string; name: string; description: string; build: () => WorkflowStage[] }[] = [
  {
    key: "single", name: "Single Approver", description: "One stage — a single executive.",
    build: () => [{ ...blankStage(), name: "Executive Approval", approver: { source: "USER_TYPE", roleId: "Executive - Procurement" } }],
  },
  {
    key: "exec-gm", name: "Executive → GM", description: "Two sequential stages, GM as head.",
    build: () => [
      { ...blankStage(), name: "Executive Approval", approver: { source: "USER_TYPE", roleId: "Executive - Procurement" } },
      { ...blankStage(), name: "GM Sign-off", approver: { source: "USER_TYPE", roleId: GM_USER_TYPE } },
    ],
  },
  {
    key: "3-level", name: "3-Level Hierarchy", description: "Executive → Food Safety & QC → GM.",
    build: () => [
      { ...blankStage(), name: "Section Executive", approver: { source: "USER_TYPE", roleId: "Executive - Production" } },
      { ...blankStage(), name: "Food Safety & QC", approver: { source: "USER_TYPE", roleId: "Executive - Food Safety and QC" } },
      { ...blankStage(), name: "GM Sign-off", approver: { source: "USER_TYPE", roleId: GM_USER_TYPE } },
    ],
  },
  {
    key: "procurement", name: "Procurement Chain", description: "Procurement → GM, skipping GM for small amounts.",
    build: () => [
      { ...blankStage(), name: "Procurement", approver: { source: "USER_TYPE", roleId: "Executive - Procurement" } },
      {
        ...blankStage(), name: "GM Sign-off", approver: { source: "USER_TYPE", roleId: GM_USER_TYPE },
        skipConditions: [{ id: uid("CND"), field: "amount", operator: "LT", value: "100000" }],
      },
    ],
  },
  {
    key: "committee", name: "Committee Decision", description: "Single committee stage with quorum.",
    build: () => [{
      ...blankStage(), name: "Review Committee",
      approver: { source: "COMMITTEE", userIds: ["S. Ahmed", "A. Haque", "R. Hossain"], quorum: 2 },
      rule: "MAJORITY",
    }],
  },
];

// ── Seed data ────────────────────────────────────────────────────────────────

const SEED: Workflow[] = [
  {
    id: "WF-0101", name: "Standard PR Approval", code: "SPA", description: "Default chain for purchase requisitions.",
    module: "PURCHASE_REQUISITION",
    scope: { departments: [], locations: [] },
    conditions: [],
    stages: [
      { ...blankStage(), name: "Procurement", approver: { source: "USER_TYPE", roleId: "Executive - Procurement" } },
      {
        ...blankStage(), name: "Store & Inventory", approver: { source: "USER_TYPE", roleId: "Executive - Store and Inventory" },
        slaHours: 72,
        skipConditions: [{ id: uid("CND"), field: "amount", operator: "LT", value: "50000" }],
      },
      { ...blankStage(), name: "GM Sign-off", approver: { source: "USER_TYPE", roleId: GM_USER_TYPE }, slaHours: 96, onSlaBreach: "ESCALATE_NEXT" },
    ],
    status: "Active", runCount: 42, lastRunAt: "2026-07-01 11:20",
    createdBy: "System Admin", createdAt: "2026-01-12 09:00", modifiedBy: "System Admin", updatedAt: "2026-06-20 15:30",
    auditLog: [
      { id: uid("AUD"), action: "Created", actor: "System Admin", timestamp: "2026-01-12 09:00" },
      { id: uid("AUD"), action: "Published", actor: "System Admin", timestamp: "2026-01-12 09:05" },
    ],
  },
  {
    id: "WF-0102", name: "PO Approval Chain", code: "POAC", description: "Purchase order approvals gated to GM.",
    module: "PURCHASE_ORDER",
    scope: { departments: ["Procurement"], locations: [] },
    conditions: [{ id: uid("CND"), field: "amount", operator: "GTE", value: "1" }],
    stages: [
      { ...blankStage(), name: "Procurement", approver: { source: "USER_TYPE", roleId: "Executive - Procurement" } },
      { ...blankStage(), name: "GM Sign-off", approver: { source: "USER_TYPE", roleId: GM_USER_TYPE }, slaHours: 72 },
    ],
    status: "Active", runCount: 27, lastRunAt: "2026-06-28 16:10",
    createdBy: "System Admin", createdAt: "2026-02-02 10:00", modifiedBy: "System Admin", updatedAt: "2026-05-11 12:00",
    auditLog: [{ id: uid("AUD"), action: "Created", actor: "System Admin", timestamp: "2026-02-02 10:00" }],
  },
  {
    id: "WF-0103", name: "Wastage Disposal Sign-off", code: "WDS", description: "Three-tier sign-off for wastage disposal.",
    module: "WASTAGE_DISPOSAL",
    scope: { departments: [], locations: [] },
    conditions: [],
    stages: [
      { ...blankStage(), name: "Production In-Charge", approver: { source: "USER_TYPE", roleId: "Executive - Production" } },
      { ...blankStage(), name: "Food Safety & QC", approver: { source: "USER_TYPE", roleId: "Executive - Food Safety and QC" }, slaHours: 72 },
      { ...blankStage(), name: "GM — Final Authorization", approver: { source: "USER_TYPE", roleId: GM_USER_TYPE }, slaHours: 96 },
    ],
    status: "Draft", runCount: 0,
    createdBy: "System Admin", createdAt: "2026-06-25 14:00", modifiedBy: "System Admin", updatedAt: "2026-06-25 14:00",
    auditLog: [{ id: uid("AUD"), action: "Created", actor: "System Admin", timestamp: "2026-06-25 14:00" }],
  },
  {
    id: "WF-0104", name: "Stock Adjustment Approval", code: "SAA", description: "Store & Inventory then GM approval.",
    module: "STOCK_ADJUSTMENT",
    scope: { departments: ["Store & Inventory"], locations: [] },
    conditions: [],
    stages: [
      { ...blankStage(), name: "Store & Inventory", approver: { source: "USER_TYPE", roleId: "Executive - Store and Inventory" } },
      { ...blankStage(), name: "GM Sign-off", approver: { source: "USER_TYPE", roleId: GM_USER_TYPE } },
    ],
    status: "Inactive", runCount: 9, lastRunAt: "2026-04-14 09:30",
    createdBy: "System Admin", createdAt: "2026-03-01 08:00", modifiedBy: "System Admin", updatedAt: "2026-06-01 09:00",
    auditLog: [
      { id: uid("AUD"), action: "Created", actor: "System Admin", timestamp: "2026-03-01 08:00" },
      { id: uid("AUD"), action: "Deactivated", actor: "System Admin", timestamp: "2026-06-01 09:00" },
    ],
  },
];

// ── Small presentational bits ────────────────────────────────────────────────

function StatusPill({ status }: { status: WorkflowStatus }) {
  const cls =
    status === "Active"   ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
    status === "Draft"    ? "bg-amber-100 text-amber-700 border-amber-200" :
                            "bg-slate-100 text-slate-600 border-slate-200";
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border", cls)}>{status}</span>;
}

function StageChainPreview({ stages }: { stages: WorkflowStage[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {stages.map((s, i) => (
        <div key={s.id} className="flex items-center gap-1">
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px]">
            {s.name || sourceLabel(s.approver.source)}
            {s.skipConditions.length > 0 && <span className="text-[9px] text-amber-600" title="Has skip condition">↷</span>}
          </span>
          {i < stages.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
        </div>
      ))}
    </div>
  );
}

/** Toggleable chip multi-select — matches the app's rounded-pill styling. */
function ChipMultiSelect({ options, value, onChange }: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            type="button"
            key={o.value}
            onClick={() => toggle(o.value)}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs border transition-colors",
              on ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
const strOpts = (arr: string[]) => arr.map((v) => ({ value: v, label: v }));

/** Reusable AND-chain condition editor (workflow entry + stage skip). */
function ConditionEditor({ conditions, onChange, addLabel }: {
  conditions: RuleCondition[];
  onChange: (next: RuleCondition[]) => void;
  addLabel: string;
}) {
  const patch = (i: number, p: Partial<RuleCondition>) => onChange(conditions.map((c, idx) => (idx === i ? { ...c, ...p } : c)));
  return (
    <div className="space-y-2">
      {conditions.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No conditions — always applies.</p>
      )}
      {conditions.map((c, i) => (
        <div key={c.id} className="flex items-center gap-2 flex-wrap">
          {i > 0 && <span className="text-[10px] font-semibold text-muted-foreground">AND</span>}
          <select value={c.field} onChange={(e) => patch(i, { field: e.target.value })} className={cn(selectCls, "!mt-0 w-40")}>
            {CONDITION_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={c.operator} onChange={(e) => patch(i, { operator: e.target.value as ConditionOperator })} className={cn(selectCls, "!mt-0 w-28")}>
            {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Input
            value={c.value}
            onChange={(e) => patch(i, { value: e.target.value })}
            placeholder={c.operator === "IN" || c.operator === "NOT_IN" ? "a, b, c" : "value"}
            className="h-9 w-40"
          />
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => onChange(conditions.filter((_, idx) => idx !== i))}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...conditions, blankCondition()])}>
        <Plus className="h-3.5 w-3.5 mr-1" /> {addLabel}
      </Button>
    </div>
  );
}

// ── Stage editor (guided, step-by-step) ──────────────────────────────────────

/** One numbered "question" card — number bubble + friendly title + hint + body. */
function StepCard({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary/40 text-primary text-xs font-semibold">{n}</span>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Clickable "who to notify" pick card (selected = ring + check). */
function NotifyCard({ active, title, desc, onClick }: { active: boolean; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left rounded-lg border p-3 transition-colors",
        active ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-sm font-semibold", active ? "text-primary" : "text-foreground")}>{title}</span>
        {active && <Check className="h-4 w-4 text-primary shrink-0" />}
      </div>
      <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
    </button>
  );
}

function StageEditor({ stage, index, total, prevLabel, nextLabel, onChange, onRemove, onMove }: {
  stage: WorkflowStage;
  index: number;
  total: number;
  prevLabel: string;   // who this stage receives from (requester or previous approver)
  nextLabel: string;   // who acts next after this stage (next approver or "approved")
  onChange: (s: WorkflowStage) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const set = (p: Partial<WorkflowStage>) => onChange({ ...stage, ...p });
  const setApprover = (p: Partial<ApproverConfig>) => onChange({ ...stage, approver: { ...stage.approver, ...p } });
  const setNotify = (p: Partial<StageNotify>) => onChange({ ...stage, notify: { ...stage.notify, ...p } });
  const src = stage.approver.source;
  const multiPerson = MULTI_PERSON_SOURCES.includes(src);
  const days = stage.slaHours > 0 ? stage.slaHours / 24 : 0;
  const dayHint = stage.slaHours > 0
    ? `That's about ${Number.isInteger(days) ? days : days.toFixed(1)} day${days === 1 ? "" : "s"} on the clock.`
    : "No time limit — the stage waits indefinitely.";

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 sm:p-4 space-y-3">
      {/* Stage header + who-hands-to-who flow */}
      <div className="flex items-start justify-between gap-2 px-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">{index + 1}</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">Stage {index + 1}{stage.name ? ` · ${stage.name}` : ""}</div>
            <div className="mt-0.5 flex items-center gap-1 flex-wrap text-[11px] text-muted-foreground">
              <span>{prevLabel}</span>
              <ArrowRight className="h-3 w-3 shrink-0" />
              <span className="inline-flex items-center gap-1 font-medium text-foreground"><UserCheck className="h-3 w-3" /> {approverText(stage.approver)}</span>
              <ArrowRight className="h-3 w-3 shrink-0" />
              <span>{nextLabel}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up"><ChevronUp className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move down"><ChevronDown className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onRemove} aria-label="Remove stage"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
        </div>
      </div>

      {/* 1 — Name */}
      <StepCard n={1} title="What's this stage called?" hint="Approvers will see this name in their task inbox.">
        <Input value={stage.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. GM Sign-off" />
      </StepCard>

      {/* 2 — Who approves */}
      <StepCard n={2} title="Who approves at this stage?" hint="Pick a source — we'll resolve the actual person(s) at runtime.">
        <select
          value={src}
          onChange={(e) => {
            const next = e.target.value as ApproverSource;
            setApprover({
              source: next,
              roleId: next === "USER_TYPE" ? (stage.approver.roleId ?? USER_TYPES[0]) : undefined,
              userIds: next === "SPECIFIC_USER" || next === "COMMITTEE" ? (stage.approver.userIds ?? []) : undefined,
              quorum: next === "COMMITTEE" ? (stage.approver.quorum ?? 1) : undefined,
            });
          }}
          className={cn(selectCls, "!mt-0")}
        >
          {APPROVER_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <p className="text-xs text-muted-foreground mt-1.5">{SOURCE_HELP[src]}</p>

        {src === "USER_TYPE" && (
          <div className="mt-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">User Type <span className="text-destructive">*</span></Label>
            <select value={stage.approver.roleId ?? ""} onChange={(e) => setApprover({ roleId: e.target.value })} className={selectCls}>
              {USER_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}
        {(src === "SPECIFIC_USER" || src === "COMMITTEE") && (
          <div className="mt-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">{src === "COMMITTEE" ? "Committee Members" : "Users"} <span className="text-destructive">*</span></Label>
            <AntdSelect
              mode="multiple"
              allowClear
              className="mt-1 w-full"
              placeholder={`Select ${src === "COMMITTEE" ? "committee members" : "users"}…`}
              value={stage.approver.userIds ?? []}
              onChange={(v: string[]) => setApprover({ userIds: v })}
              options={USERS.map((u) => ({ value: u, label: u }))}
              optionFilterProp="label"
            />
            {src === "COMMITTEE" && (
              <div className="mt-3 sm:w-48">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Quorum</Label>
                <Input
                  type="number" min={1}
                  value={stage.approver.quorum ?? 1}
                  onChange={(e) => setApprover({ quorum: Math.max(1, Number(e.target.value) || 1) })}
                  className="mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">Minimum approvals needed ({(stage.approver.userIds ?? []).length} members).</p>
              </div>
            )}
          </div>
        )}

        {multiPerson && (
          <div className="mt-3 sm:w-1/2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">How many must approve?</Label>
            <select value={stage.rule} onChange={(e) => set({ rule: e.target.value as ApprovalRule })} className={selectCls}>
              {APPROVAL_RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
          <label className="flex items-center gap-2 text-sm"><Switch checked={stage.allowDelegate} onCheckedChange={(v) => set({ allowDelegate: v })} /> Approver can delegate</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={stage.requireRejectComment} onCheckedChange={(v) => set({ requireRejectComment: v })} /> Require a reason to reject</label>
        </div>
      </StepCard>

      {/* 3 — Response time (renamed SLA) */}
      <StepCard n={3} title="How long do they have to respond?" hint="Set a time limit and what happens if no one responds.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Time Limit</Label>
            <div className="flex mt-1">
              <Input
                type="number" min={0}
                value={stage.slaHours}
                onChange={(e) => set({ slaHours: Math.max(0, Number(e.target.value) || 0) })}
                className="rounded-r-none"
              />
              <span className="inline-flex items-center px-3 rounded-r-md border border-l-0 border-input bg-muted/40 text-sm text-muted-foreground shrink-0">hours</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{dayHint}</p>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">If nobody responds in time</Label>
            <select value={stage.onSlaBreach} onChange={(e) => set({ onSlaBreach: e.target.value as EscalationAction })} className={selectCls}>
              {ESCALATION_ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">{ESCALATION_DESC[stage.onSlaBreach]}</p>
          </div>
        </div>
      </StepCard>

      {/* 4 — Notifications */}
      <StepCard n={4} title="Who should be notified?" hint="Pick who gets pinged when this stage activates.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <NotifyCard active={stage.notify.initiator} title="The requester" desc="Person who submitted." onClick={() => setNotify({ initiator: !stage.notify.initiator })} />
          <NotifyCard active={stage.notify.approvers} title="Approvers" desc="Everyone who can decide here." onClick={() => setNotify({ approvers: !stage.notify.approvers })} />
          <NotifyCard active={stage.notify.gm} title="GM" desc="General Manager / head." onClick={() => setNotify({ gm: !stage.notify.gm })} />
        </div>
        <div className="mt-3">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Also notify (user types)</Label>
          <AntdSelect
            mode="multiple"
            allowClear
            className="mt-1 w-full"
            placeholder="Optional — extra user types to CC…"
            value={stage.notify.customRoleIds}
            onChange={(v: string[]) => setNotify({ customRoleIds: v })}
            options={USER_TYPES.map((u) => ({ value: u, label: u }))}
            optionFilterProp="label"
          />
        </div>
        <div className="mt-3">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Send via</Label>
          <AntdSelect
            mode="multiple"
            allowClear
            className="mt-1 w-full"
            placeholder="Pick channels…"
            value={stage.notify.channels}
            onChange={(v: NotifyChannel[]) => setNotify({ channels: v })}
            options={NOTIFY_CHANNELS}
            optionFilterProp="label"
          />
        </div>
      </StepCard>

      {/* 5 — Skip conditions */}
      <StepCard n={5} title="Skip this stage automatically?" hint="Bypass this stage when all the conditions below are true. Leave empty to always run it.">
        <ConditionEditor conditions={stage.skipConditions} onChange={(next) => set({ skipConditions: next })} addLabel="Add Skip Condition" />
      </StepCard>
    </div>
  );
}

// ── Workflow form ────────────────────────────────────────────────────────────

function WorkflowForm({ initial, nextId, actor, onSave }: {
  initial: Workflow | null;
  nextId: string;
  actor: string;
  onSave: (wf: Workflow) => void;
}) {
  const isEdit = initial !== null;
  const [draft, setDraft] = useState<Workflow>(() => initial ?? blankWorkflow(nextId, actor));
  const [codeTouched, setCodeTouched] = useState<boolean>(isEdit);
  const [templateKey, setTemplateKey] = useState<string>("");

  const patch = (p: Partial<Workflow>) => setDraft((d) => ({ ...d, ...p }));
  const patchScope = (p: Partial<ScopeFilter>) => setDraft((d) => ({ ...d, scope: { ...d.scope, ...p } }));
  const patchStage = (i: number, s: WorkflowStage) => setDraft((d) => ({ ...d, stages: d.stages.map((x, idx) => (idx === i ? s : x)) }));
  const removeStage = (i: number) => setDraft((d) => ({ ...d, stages: d.stages.filter((_, idx) => idx !== i) }));
  const addStage = () => setDraft((d) => ({ ...d, stages: [...d.stages, blankStage()] }));
  const moveStage = (i: number, dir: -1 | 1) => setDraft((d) => {
    const j = i + dir;
    if (j < 0 || j >= d.stages.length) return d;
    const next = [...d.stages];
    [next[i], next[j]] = [next[j], next[i]];
    return { ...d, stages: next };
  });

  const onNameChange = (name: string) => setDraft((d) => ({ ...d, name, code: codeTouched ? d.code : deriveCode(name) }));

  const applyTemplate = (key: string) => {
    const t = TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    setDraft((d) => ({ ...d, stages: t.build() }));
    setTemplateKey(key); // lock the selection in the dropdown
    toast.success(`Applied template: ${t.name}`);
  };

  // Validate per spec §3. Returns error string or null.
  const validate = (): string | null => {
    if (!draft.name.trim()) return "Workflow name is required.";
    if (!draft.code.trim()) return "Workflow code is required.";
    if (draft.stages.length === 0) return "At least one stage is required.";
    for (const s of draft.stages) {
      if (!s.name.trim()) return "Every stage needs a name.";
      if (s.approver.source === "USER_TYPE" && !s.approver.roleId) return `Stage "${s.name}" — select a user type.`;
      if ((s.approver.source === "SPECIFIC_USER" || s.approver.source === "COMMITTEE") && !(s.approver.userIds && s.approver.userIds.length))
        return `Stage "${s.name}" — select at least one user.`;
      if (s.approver.source === "COMMITTEE" && (s.approver.quorum ?? 1) > (s.approver.userIds ?? []).length)
        return `Stage "${s.name}" — quorum cannot exceed committee size.`;
    }
    return null;
  };

  const commit = (mode: "draft" | "publish" | "update") => {
    const err = validate();
    if (err) { toast.error(err); return; }

    // Soft, non-blocking warning per spec.
    const risky = draft.stages.find((s) => s.slaHours > 168 && s.onSlaBreach === "NOTIFY_ONLY");
    if (risky) toast.warning(`Stage "${risky.name}" has SLA > 168h with Notify-only — it can expire silently.`);

    const finalStatus: WorkflowStatus = mode === "publish" ? "Active" : mode === "draft" ? "Draft" : draft.status;
    const ts = nowStamp();

    // Build audit entries.
    const mk = (action: AuditAction, changes?: AuditChange[], note?: string): AuditEntry =>
      ({ id: uid("AUD"), action, actor, timestamp: ts, changes, note });
    const log: AuditEntry[] = [];

    if (!isEdit) {
      log.push(mk("Created"));
      if (finalStatus === "Active") log.push(mk("Published"));
    } else {
      const changes = diffWorkflow(initial!, { ...draft, status: finalStatus });
      if (changes.length) log.push(mk("Updated", changes));
      stageStructuralAudits(initial!.stages, draft.stages).forEach((a) => log.push(mk(a.action, undefined, a.note)));
      if (initial!.status !== finalStatus) {
        if (finalStatus === "Active") log.push(mk(initial!.status === "Draft" ? "Published" : "Activated"));
        else if (finalStatus === "Inactive") log.push(mk("Deactivated"));
      }
    }

    const saved: Workflow = {
      ...draft,
      name: draft.name.trim(),
      code: draft.code.trim().toUpperCase(),
      status: finalStatus,
      modifiedBy: actor,
      updatedAt: ts,
      auditLog: [...draft.auditLog, ...log],
    };
    onSave(saved);
    toast.success(isEdit ? `Workflow "${saved.name}" saved.` : `Workflow "${saved.name}" ${finalStatus === "Active" ? "published" : "saved as draft"}.`);
  };

  const singleSaveMode = isEdit && draft.status !== "Draft";

  return (
    <div className="space-y-6">
      {/* Basics */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" /> {isEdit ? "Edit Workflow" : "Workflow Definition"}
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              {singleSaveMode ? (
                <Button onClick={() => commit("update")}><Save className="h-4 w-4 mr-1.5" /> Save Changes</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => commit("draft")}><Save className="h-4 w-4 mr-1.5" /> Save Draft</Button>
                  <Button onClick={() => commit("publish")}><Send className="h-4 w-4 mr-1.5" /> Publish</Button>
                </>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Workflow #</Label>
              <Input value={draft.id} disabled className="mt-1 font-mono" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Module <span className="text-destructive">*</span></Label>
              <select value={draft.module} onChange={(e) => patch({ module: e.target.value as TriggerModule })} className={selectCls}>
                {MODULES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Workflow Name <span className="text-destructive">*</span></Label>
              <Input value={draft.name} onChange={(e) => onNameChange(e.target.value)} className="mt-1" placeholder="e.g. Standard PR Approval" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Code <span className="text-destructive">*</span></Label>
              <Input value={draft.code} onChange={(e) => { setCodeTouched(true); patch({ code: e.target.value.toUpperCase() }); }} className="mt-1 font-mono" placeholder="Auto from name" />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Description</Label>
              <Textarea value={draft.description} onChange={(e) => patch({ description: e.target.value })} className="mt-1" placeholder="What this approval chain governs..." />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Scope */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-1">Scope (Eligibility)</h3>
          <p className="text-xs text-muted-foreground mb-4">Leave a filter empty to match all. Fewer wildcards = more specific — the most specific matching workflow wins at runtime.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div><Label className="text-xs uppercase tracking-wider text-muted-foreground">Departments</Label><ChipMultiSelect options={strOpts(SCOPE_DEPARTMENTS)} value={draft.scope.departments} onChange={(v) => patchScope({ departments: v })} /></div>
            <div><Label className="text-xs uppercase tracking-wider text-muted-foreground">Locations</Label><ChipMultiSelect options={strOpts(SCOPE_LOCATIONS)} value={draft.scope.locations} onChange={(v) => patchScope({ locations: v })} /></div>
          </div>
        </CardContent>
      </Card>

      {/* Entry conditions */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider mb-1">Entry Conditions</h3>
          <p className="text-xs text-muted-foreground mb-4">All conditions must be true (AND) for this workflow to apply to a request.</p>
          <ConditionEditor conditions={draft.conditions} onChange={(next) => patch({ conditions: next })} addLabel="Add Condition" />
        </CardContent>
      </Card>

      {/* Stages */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider shrink-0">Approval Stages ({draft.stages.length})</h3>

            {/* Plain-language flow summary — only while a starter template is selected */}
            {templateKey && draft.stages.length > 0 && (
              <div className="order-3 basis-full lg:order-none lg:basis-auto lg:flex-1 min-w-0 rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-1.5 text-[11px] leading-relaxed">
                <span className="font-semibold text-foreground">
                  {`${TEMPLATES.find((t) => t.key === templateKey)?.name}: `}
                </span>
                <span className="text-muted-foreground">{flowText(draft.stages)}</span>
              </div>
            )}

            <div className="flex items-center gap-2 shrink-0">
              <select
                className={cn(selectCls, "!mt-0 w-56")}
                value={templateKey}
                onChange={(e) => { if (e.target.value) applyTemplate(e.target.value); else setTemplateKey(""); }}
              >
                <option value="">Apply starter template…</option>
                {TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
              </select>
              <Button variant="outline" onClick={addStage}><Plus className="h-4 w-4 mr-1" /> Add Stage</Button>
            </div>
          </div>

          {draft.stages.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8 border border-border rounded-md">
              No stages yet. Add a stage or apply a starter template.
            </div>
          ) : (
            <div className="space-y-3">
              {draft.stages.map((s, i) => (
                <StageEditor
                  key={s.id}
                  stage={s}
                  index={i}
                  total={draft.stages.length}
                  prevLabel={i === 0 ? "Requester (submitter)" : approverText(draft.stages[i - 1].approver)}
                  nextLabel={i < draft.stages.length - 1 ? approverText(draft.stages[i + 1].approver) : "Request approved"}
                  onChange={(ns) => patchStage(i, ns)}
                  onRemove={() => removeStage(i)}
                  onMove={(dir) => moveStage(i, dir)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Audit diffing ────────────────────────────────────────────────────────────

function diffWorkflow(oldW: Workflow, newW: Workflow): AuditChange[] {
  const rows: [string, string, string][] = [
    ["Name", oldW.name, newW.name],
    ["Code", oldW.code, newW.code],
    ["Description", oldW.description, newW.description],
    ["Module", moduleLabel(oldW.module), moduleLabel(newW.module)],
    ["Status", oldW.status, newW.status],
    ["Scope", scopeSummary(oldW.scope), scopeSummary(newW.scope)],
    ["Conditions", condsSummary(oldW.conditions), condsSummary(newW.conditions)],
    ["Stage count", String(oldW.stages.length), String(newW.stages.length)],
  ];
  return rows
    .filter(([, a, b]) => a !== b)
    .map(([field, from, to]) => ({ field, from: from || "—", to: to || "—" }));
}

function stageStructuralAudits(oldStages: WorkflowStage[], newStages: WorkflowStage[]): { action: AuditAction; note: string }[] {
  const oldIds = oldStages.map((s) => s.id);
  const newIds = newStages.map((s) => s.id);
  const added = newIds.filter((id) => !oldIds.includes(id));
  const removed = oldIds.filter((id) => !newIds.includes(id));
  const out: { action: AuditAction; note: string }[] = [];
  added.forEach((id) => out.push({ action: "Stage Added", note: `Stage "${newStages.find((s) => s.id === id)?.name || id}" added` }));
  removed.forEach((id) => out.push({ action: "Stage Removed", note: `Stage "${oldStages.find((s) => s.id === id)?.name || id}" removed` }));
  if (added.length === 0 && removed.length === 0 && oldIds.join(",") !== newIds.join(",")) {
    out.push({ action: "Stage Reordered", note: "Stages reordered" });
  }
  return out;
}

// ── View dialog ──────────────────────────────────────────────────────────────

function WorkflowViewDialog({ workflow, onClose, onEdit }: {
  workflow: Workflow | null;
  onClose: () => void;
  onEdit: (wf: Workflow) => void;
}) {
  return (
    <Dialog open={workflow !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            {workflow?.name}{" "}
            <span className="font-mono text-xs text-muted-foreground">({workflow?.code} · {workflow?.id})</span>
          </DialogTitle>
        </DialogHeader>
        {workflow && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Module</div><div className="font-medium">{moduleLabel(workflow.module)}</div></div>
              <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</div><StatusPill status={workflow.status} /></div>
              <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Runs</div><div className="font-medium tabular-nums">{workflow.runCount}{workflow.lastRunAt ? ` · last ${workflow.lastRunAt}` : ""}</div></div>
              <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Updated</div><div className="font-medium">{workflow.updatedAt} · {workflow.modifiedBy}</div></div>
              {workflow.description && <div className="col-span-2"><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Description</div><div className="text-sm">{workflow.description}</div></div>}
              <div className="col-span-2"><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Scope</div><div className="text-sm">{scopeSummary(workflow.scope)}</div></div>
              <div className="col-span-2"><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Entry Conditions</div><div className="text-sm">{condsSummary(workflow.conditions)}</div></div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Approval Chain</div>
              <div className="space-y-2">
                {workflow.stages.map((s, i) => (
                  <div key={s.id} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">{i + 1}</div>
                      <div className="text-sm font-medium flex-1">{s.name} <span className="text-muted-foreground font-normal">· {approverText(s.approver)}</span></div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> {s.slaHours}h</div>
                    </div>
                    <div className="mt-1.5 pl-9 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      {MULTI_PERSON_SOURCES.includes(s.approver.source) && <span>Rule: {APPROVAL_RULES.find((r) => r.value === s.rule)?.label}</span>}
                      <span>On breach: {ESCALATION_ACTIONS.find((a) => a.value === s.onSlaBreach)?.label}</span>
                      {s.allowDelegate && <span>Delegable</span>}
                      {s.requireRejectComment && <span>Reject needs comment</span>}
                      {s.skipConditions.length > 0 && <span className="text-amber-600">Skip if: {condsSummary(s.skipConditions)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> Audit Trail</div>
              <div className="border border-border rounded-md divide-y divide-border max-h-56 overflow-y-auto">
                {[...workflow.auditLog].reverse().map((a) => (
                  <div key={a.id} className="px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{a.action}</span>
                      <span className="text-muted-foreground tabular-nums">{a.timestamp} · {a.actor}</span>
                    </div>
                    {a.note && <div className="text-muted-foreground mt-0.5">{a.note}</div>}
                    {a.changes && a.changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {a.changes.map((c, idx) => (
                          <li key={idx} className="text-muted-foreground">
                            <span className="font-medium text-foreground">{c.field}:</span> {c.from} → {c.to}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                {workflow.auditLog.length === 0 && <div className="px-3 py-4 text-xs text-muted-foreground text-center">No audit entries.</div>}
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {workflow && <Button onClick={() => onEdit(workflow)}><Pencil className="h-4 w-4 mr-1.5" /> Edit</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── List ─────────────────────────────────────────────────────────────────────

function WorkflowList({ data, onView, onEdit, onClone, onStatusAction }: {
  data: Workflow[];
  onView: (wf: Workflow) => void;
  onEdit: (wf: Workflow) => void;
  onClone: (wf: Workflow) => void;
  onStatusAction: (wf: Workflow) => void;
}) {
  const cols: Column<Workflow>[] = [
    { key: "id", header: "Workflow #", render: (r) => <span className="font-mono text-xs">{r.id}</span> },
    {
      key: "name", header: "Name",
      render: (r) => (
        <div>
          <div className="font-medium text-sm">{r.name}</div>
          <div className="text-[11px] text-muted-foreground font-mono">{r.code}</div>
        </div>
      ),
    },
    { key: "module", header: "Module", render: (r) => moduleLabel(r.module) },
    { key: "stages", header: "Approval Chain", render: (r) => <StageChainPreview stages={r.stages} /> },
    { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
    { key: "runCount", header: "Runs", render: (r) => <span className="tabular-nums">{r.runCount}</span> },
    { key: "updatedAt", header: "Updated", render: (r) => <span className="text-xs text-muted-foreground tabular-nums">{r.updatedAt}</span> },
  ];

  const rowMenu = (r: Workflow): MenuProps["items"] => {
    const statusItem =
      r.status === "Draft"  ? { key: "status", icon: <Send className="h-4 w-4" />,  label: "Publish" } :
      r.status === "Active" ? { key: "status", icon: <Power className="h-4 w-4" />, label: "Deactivate", danger: true } :
                              { key: "status", icon: <Power className="h-4 w-4" />, label: "Activate" };
    return [
      { key: "view",  icon: <Eye className="h-4 w-4" />,    label: "View" },
      { key: "edit",  icon: <Pencil className="h-4 w-4" />, label: "Edit" },
      { key: "clone", icon: <Copy className="h-4 w-4" />,   label: "Clone" },
      { type: "divider" },
      statusItem,
    ];
  };

  const onMenuClick = (r: Workflow, key: string) => {
    if (key === "view") onView(r);
    else if (key === "edit") onEdit(r);
    else if (key === "clone") onClone(r);
    else if (key === "status") onStatusAction(r);
  };

  return (
    <DataTable
      title="workflows"
      data={data}
      columns={cols}
      searchKeys={["id", "name", "code", "module"]}
      selectable={false}
      actions={(r) => (
        <Dropdown menu={{ items: rowMenu(r), onClick: ({ key }) => onMenuClick(r, key) }} trigger={["click"]} placement="bottomRight">
          <AntdButton type="text" size="small" aria-label="Row actions" icon={<MoreHorizontal className="h-4 w-4" />} />
        </Dropdown>
      )}
    />
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ConfigApprovalPage() {
  const { role } = useRole();
  const actor = role || "Admin";
  const [rows, setRows] = usePersistedState<Workflow[]>("config-approval-workflows-v2", SEED);
  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [viewing, setViewing] = useState<Workflow | null>(null);
  const [confirm, setConfirm] = useState<{ wf: Workflow; next: WorkflowStatus; action: AuditAction } | null>(null);

  const save = (wf: Workflow) => {
    setRows((p) => (p.some((r) => r.id === wf.id) ? p.map((r) => (r.id === wf.id ? wf : r)) : [wf, ...p]));
    setView("list");
    setEditing(null);
  };

  const startCreate = () => { setEditing(null); setView("form"); };
  const startEdit = (wf: Workflow) => { setEditing(wf); setView("form"); };
  const backToList = () => { setEditing(null); setView("list"); };

  const clone = (wf: Workflow) => {
    const id = genWorkflowId(rows);
    const ts = nowStamp();
    const copy: Workflow = {
      ...wf,
      id,
      name: `${wf.name} (Copy)`,
      code: deriveCode(`${wf.name} Copy`),
      status: "Draft",
      runCount: 0,
      lastRunAt: undefined,
      createdBy: actor, createdAt: ts, modifiedBy: actor, updatedAt: ts,
      stages: reidStages(wf.stages),
      conditions: wf.conditions.map((c) => ({ ...c, id: uid("CND") })),
      scope: { departments: [...wf.scope.departments], locations: [...wf.scope.locations] },
      auditLog: [{ id: uid("AUD"), action: "Cloned", actor, timestamp: ts, note: `Cloned from ${wf.id}` }],
    };
    setRows((p) => [copy, ...p]);
    toast.success(`Cloned "${wf.name}" → ${id} (Draft).`);
  };

  // Draft → publish (no confirm). Active/Inactive → confirm modal.
  const onStatusAction = (wf: Workflow) => {
    if (wf.status === "Draft") { applyStatus(wf, "Active", "Published"); return; }
    if (wf.status === "Active") { setConfirm({ wf, next: "Inactive", action: "Deactivated" }); return; }
    setConfirm({ wf, next: "Active", action: "Activated" });
  };

  const applyStatus = (wf: Workflow, next: WorkflowStatus, action: AuditAction) => {
    const ts = nowStamp();
    const entry: AuditEntry = { id: uid("AUD"), action, actor, timestamp: ts };
    setRows((p) => p.map((r) => (r.id === wf.id ? { ...r, status: next, modifiedBy: actor, updatedAt: ts, auditLog: [...r.auditLog, entry] } : r)));
    toast.success(`${wf.name} — ${action.toLowerCase()}.`);
  };

  return (
    <>
      <PageHeader
        title="Approval Setup"
        subtitle="Define configurable, multi-stage approval workflows for procurement, inventory & finance documents"
        actions={
          <Button
            variant={view === "form" ? "outline" : "default"}
            onClick={() => (view === "form" ? backToList() : startCreate())}
          >
            {view === "form" ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back</> : <><Plus className="h-4 w-4 mr-1" /> Create Workflow</>}
          </Button>
        }
      />

      {view === "list" ? (
        <WorkflowList
          data={rows}
          onView={(wf) => setViewing(wf)}
          onEdit={startEdit}
          onClone={clone}
          onStatusAction={onStatusAction}
        />
      ) : (
        <WorkflowForm
          initial={editing}
          nextId={genWorkflowId(rows)}
          actor={actor}
          onSave={save}
        />
      )}

      <WorkflowViewDialog workflow={viewing} onClose={() => setViewing(null)} onEdit={(wf) => { setViewing(null); startEdit(wf); }} />

      {/* Activate / Deactivate confirm */}
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirm?.next === "Active" ? <Power className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
              {confirm?.action} Workflow
            </DialogTitle>
          </DialogHeader>
          {confirm && (
            <p className="text-sm text-muted-foreground">
              {confirm.next === "Active"
                ? <>Activate <strong className="text-foreground">{confirm.wf.name}</strong>? It will start matching new requests for {moduleLabel(confirm.wf.module)}.</>
                : <>Deactivate <strong className="text-foreground">{confirm.wf.name}</strong>? It will stop matching new requests (in-flight approvals are unaffected).</>}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              className={confirm?.next === "Inactive" ? "bg-amber-600 hover:bg-amber-700" : ""}
              onClick={() => { if (confirm) { applyStatus(confirm.wf, confirm.next, confirm.action); setConfirm(null); } }}
            >
              {confirm?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

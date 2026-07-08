import { useState, useMemo, useEffect, type ReactNode } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Plus, ArrowLeft, Save, Users, CheckCircle, ShieldCheck, KeyRound, Mail, Phone,
  Briefcase, IdCard, History, X,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { getAuditEvents, type AuditEvent } from "@/lib/audit-log";
import { KpiCard } from "@/components/common/KpiCard";
import { ROLES, type Role } from "@/lib/roles";
import { STAFF_SEED, type StaffMember } from "@/lib/staff";
import { rowEditors } from "@/lib/row-editors";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Select as AntSelect } from "antd";
import { activeOffices, activeWarehouses, warehouses } from "@/lib/sample-data";
import { officeName, warehouseName } from "@/components/common/LocationPicker";


// The staff/user shape and seed live in @/lib/staff so other modules (e.g. the
// Item Issue recipient picker) share a single source of truth.
type UserRow = StaffMember;

const LOCATIONS = [
  "Head Office Dhaka",
  "Central Warehouse",
  "Hot Kitchen",
  "Cold Kitchen",
  "Cold Storage 1",
  "Regional Warehouse CXB",
];

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const SEED: UserRow[] = STAFF_SEED;

function initials(name: string) {
  const parts = name.replace(/\./g, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── HR master seed lists. The +ADD NEW selects append to persisted copies of
// these (keys below) so runtime additions survive reloads. ────────────────────
const DESIGNATIONS = ["General Manager", "Manager", "Executive", "Officer", "Supervisor", "Head Chef", "Sous Chef", "Store Keeper", "Driver", "Helper"];
const HR_POSITIONS = ["Head of Department", "Team Lead", "Senior", "Junior", "Trainee"];
const DEPARTMENTS = ["Flight Kitchen", "Store & Inventory", "Procurement", "Food Safety & QC", "Packaging & Dispatch", "Administration", "Accounts"];
const DEPARTMENT_SECTIONS = ["Hot Kitchen", "Cold Kitchen", "Bakery", "Butchery", "Dispatch", "Receiving"];
const EMPLOYEE_TYPES = ["Permanent", "Contractual", "Probation", "Intern", "Casual"];
const RELIGIONS = ["Islam", "Hinduism", "Christianity", "Buddhism", "Other"];
const GENDERS = ["Male", "Female", "Other"];
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];

const labelCls = "text-xs uppercase tracking-wider text-muted-foreground";

/** A labelled <select> whose options can be extended inline via "+ ADD NEW". */
function AddableSelect({
  label, required, value, onChange, options, onAddOption,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onAddOption: (v: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const commit = () => {
    const v = draft.trim();
    if (!v) { setAdding(false); return; }
    if (!options.includes(v)) onAddOption(v);
    onChange(v);
    setDraft("");
    setAdding(false);
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <Label className={labelCls}>{label}{required && <span className="text-destructive"> *</span>}</Label>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
        >
          <Plus className="h-3 w-3" /> ADD NEW
        </button>
      </div>
      {adding ? (
        <div className="mt-1 flex gap-1.5">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
            placeholder={`New ${label}…`}
            className="h-9"
          />
          <Button type="button" size="sm" className="h-9 shrink-0" onClick={commit}>Add</Button>
        </div>
      ) : (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
          <option value="">{`Select ${label}…`}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
    </div>
  );
}

/** Plain labelled <select> (no add-new). */
function PlainSelect({
  label, required, value, onChange, options,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <Label className={labelCls}>{label}{required && <span className="text-destructive"> *</span>}</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
        <option value="">{`Select ${label}…`}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

/** Labelled text/date <Input>. */
function Field({
  label, required, value, onChange, type = "text", placeholder,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <Label className={labelCls}>{label}{required && <span className="text-destructive"> *</span>}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1" />
    </div>
  );
}

export default function UserManagementPage() {
  const [rows, setRows] = usePersistedState<UserRow[]>("users-rows", SEED);
  const [view, setView] = useState<"list" | "create">("list");

  const toggle = (id: string) =>
    setRows((p) =>
      p.map((r) => (r.id === id ? { ...r, status: r.status === "Active" ? "Inactive" : "Active" } : r)),
    );

  const add = (u: UserRow) => { setRows((p) => [u, ...p]); setView("list"); };

  const active = rows.filter((r) => r.status === "Active").length;
  const admins = rows.filter((r) => r.role === "GM/Admin").length;

  return (
    <>
      <PageHeader
        title="User Management"
        subtitle="Manage system users, role assignments and access status across the catering operation"
        actions={
          <Button
            variant={view === "create" ? "outline" : "default"}
            onClick={() => setView(view === "create" ? "list" : "create")}
          >
            {view === "create" ? <><ArrowLeft className="h-4 w-4 mr-1" /> Back</> : <><Plus className="h-4 w-4 mr-1" /> Create User</>}
          </Button>
        }
      />

      {view === "list" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KpiCard label="Total Users" value={rows.length} icon={Users} tone="navy" />
            <KpiCard label="Active" value={active} icon={CheckCircle} tone="success" />
            <KpiCard label="Admins" value={admins} icon={ShieldCheck} tone="warning" />
          </div>
          <UserList data={rows} onToggle={toggle} editors={rowEditors(setRows)} />
        </>
      ) : (
        <UserCreate nextId={`USR-${String(rows.length + 1).padStart(3, "0")}`} onSave={add} />
      )}
    </>
  );
}

function UserList({
  data, onToggle, editors,
}: {
  data: UserRow[];
  onToggle: (id: string) => void;
  editors: { onSave: (u: Record<string, unknown>) => void; onDelete: (u: Record<string, unknown>) => void };
}) {
  // The user whose individual activity log is open (from the Actions menu).
  const [logUser, setLogUser] = useState<UserRow | null>(null);

  const cols: Column<UserRow>[] = [
    { key: "id", header: "ID" },
    {
      key: "fullName",
      header: "User",
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary text-primary-foreground text-[11px] font-semibold">
              {initials(r.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="leading-tight min-w-0">
            <div className="text-sm font-medium truncate">{r.fullName}</div>
            <div className="text-[11px] text-muted-foreground font-mono truncate">@{r.username}</div>
          </div>
        </div>
      ),
    },
    {
      key: "email",
      header: "Contact",
      render: (r) => (
        <div className="leading-tight">
          <div className="text-xs text-foreground truncate">{r.email}</div>
          <div className="text-[11px] text-muted-foreground truncate">{r.phone}</div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (r) => (
        <Badge variant="outline" className="font-normal text-[10px]">
          <ShieldCheck className="h-2.5 w-2.5 mr-1" /> {r.role}
        </Badge>
      ),
    },
    { key: "location", header: "Location", render: (r) => <span className="text-xs">{r.location}</span> },
    { key: "lastLogin", header: "Last Login", render: (r) => <span className="text-xs text-muted-foreground tabular-nums">{r.lastLogin}</span> },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const active = r.status === "Active";
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={active}
              onCheckedChange={() => onToggle(r.id)}
              aria-label={`${active ? "Deactivate" : "Activate"} ${r.id}`}
            />
            <span className={cn("text-xs font-medium", active ? "text-success" : "text-muted-foreground")}>
              {r.status}
            </span>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        title="users"
        data={data}
        columns={cols}
        searchKeys={["id", "username", "fullName", "email", "role", "location"]}
        selectable={false}
        actions={(r) => (
          <RowActions
            row={r}
            actions={["view", "edit", "print"]}
            detail={<UserDetail row={r} />}
            onSave={editors.onSave}
            editDetail={({ save, close }) => <UserFields mode="edit" initial={r} onSubmit={save} onClose={close} />}
            extraActions={[
              {
                key: "activity",
                label: "Activity Log",
                icon: <History size={14} />,
                onClick: (row) => setLogUser(row as UserRow),
              },
            ]}
          />
        )}
      />
      <UserActivityLog user={logUser} onClose={() => setLogUser(null)} />
    </>
  );
}

/** Which audit-log events belong to a given user (actor matched loosely). */
function eventsForUser(u: UserRow): AuditEvent[] {
  const names = new Set([u.fullName, u.username, u.role].filter(Boolean).map((s) => s.toLowerCase()));
  return getAuditEvents().filter((e) => names.has((e.actor ?? "").toLowerCase()));
}

function UserActivityLog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const events = useMemo(() => (user ? eventsForUser(user) : []), [user]);

  // Filters
  const [q, setQ] = useState("");
  const [moduleFilter, setModuleFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Reset filters when the dialog switches to a different user.
  useEffect(() => {
    setQ(""); setModuleFilter("All"); setDateFrom(""); setDateTo("");
  }, [user?.id]);

  // Distinct modules this user has activity in (for the Module dropdown).
  const modules = useMemo(
    () => Array.from(new Set(events.map((e) => e.module))).sort((a, b) => a.localeCompare(b)),
    [events],
  );

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return events.filter((e) => {
      if (moduleFilter !== "All" && e.module !== moduleFilter) return false;
      const day = e.ts.slice(0, 10); // ISO date part (YYYY-MM-DD)
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (ql) {
        const hay = `${e.action} ${e.entity} ${e.detail ?? ""} ${e.module}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [events, q, moduleFilter, dateFrom, dateTo]);

  const hasFilters = !!q || moduleFilter !== "All" || !!dateFrom || !!dateTo;
  const clearFilters = () => { setQ(""); setModuleFilter("All"); setDateFrom(""); setDateTo(""); };

  return (
    <Dialog open={!!user} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Activity Log — {user?.fullName}
            </span>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="px-5 py-3 border-b border-border bg-muted/20 flex flex-wrap items-end gap-2 min-w-0">
          <div className="flex-1 min-w-[150px]">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Search</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Action, record, detail…"
              className="mt-1 h-8"
            />
          </div>
          <div className="min-w-[130px]">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Module</Label>
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className={selectCls + " !h-8"}
            >
              <option value="All">All modules</option>
              {modules.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="mt-1 h-8" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="mt-1 h-8" />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-8" onClick={clearFilters}>
              <X className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          )}
        </div>

        {/* Result count */}
        <div className="px-5 pt-3 text-[11px] text-muted-foreground tabular-nums">
          Showing <strong className="text-foreground">{filtered.length}</strong>
          {hasFilters ? ` of ${events.length}` : ""} {events.length === 1 ? "event" : "events"}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {events.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No recorded activity for this user yet.
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No activity matches these filters.
              <button onClick={clearFilters} className="ml-1 text-primary underline underline-offset-2">Clear filters</button>
            </div>
          ) : (
            <ol className="relative border-l border-border ml-2 space-y-4">
              {filtered.map((e) => (
                <li key={e.id} className="ml-4">
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-foreground">{e.action}</span>
                    <Badge variant="outline" className="font-normal text-[10px]">{e.module}</Badge>
                    <span className="text-[11px] text-muted-foreground font-mono">{e.entity}</span>
                  </div>
                  {e.detail && <div className="mt-0.5 text-xs text-muted-foreground">{e.detail}</div>}
                  <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                    {new Date(e.ts).toLocaleString()}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UserDetail({ row }: { row: UserRow }) {
  return (
    <div className="space-y-5 pt-2">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-14 w-14">
            <AvatarFallback className="bg-primary text-primary-foreground text-base font-semibold">
              {initials(row.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-foreground">{row.fullName}</div>
            <div className="text-[11px] text-muted-foreground font-mono">@{row.username} · {row.id}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="outline" className="font-normal text-[10px]">
                <ShieldCheck className="h-2.5 w-2.5 mr-1" /> {row.role}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "font-normal text-[10px]",
                  row.status === "Active"
                    ? "bg-success/10 text-success border-success/30"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {row.status}
              </Badge>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Contact</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Detail label="Email"      value={<span className="inline-flex items-center gap-1.5"><Mail className="h-3 w-3 text-muted-foreground" /> {row.email || "—"}</span>} />
          <Detail label="Mobile No"  value={<span className="inline-flex items-center gap-1.5"><Phone className="h-3 w-3 text-muted-foreground" /> {row.phone}</span>} />
          <Detail label="Office"     value={row.location} />
          <Detail label="Last Login" value={<span className="font-mono text-xs text-muted-foreground">{row.lastLogin}</span>} />
        </div>
      </section>

      {((row.officeAccess?.length ?? 0) > 0 || (row.warehouseAccess?.length ?? 0) > 0) && (
        <section className="rounded-md border border-border bg-card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">System Access</h4>
          <div className="space-y-3">
            {(row.officeAccess?.length ?? 0) > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Offices ({row.officeAccess!.length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {row.officeAccess!.map((id) => (
                    <Badge key={id} variant="outline" className="font-normal text-[10px]">{officeName(id)}</Badge>
                  ))}
                </div>
              </div>
            )}
            {(row.warehouseAccess?.length ?? 0) > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Warehouses ({row.warehouseAccess!.length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {row.warehouseAccess!.map((id) => (
                    <Badge key={id} variant="outline" className="font-normal text-[10px]">{warehouseName(id)}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {(row.designation || row.hrPosition || row.employeeType || row.department || row.departmentSection || row.joiningDate) && (
        <section className="rounded-md border border-border bg-card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Employment</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {row.designation       && <Detail label="Designation"        value={row.designation} />}
            {row.hrPosition        && <Detail label="HR Position"        value={row.hrPosition} />}
            {row.employeeType      && <Detail label="Employee Type"      value={row.employeeType} />}
            {row.department        && <Detail label="Department"         value={row.department} />}
            {row.departmentSection && <Detail label="Department Section" value={row.departmentSection} />}
            {row.joiningDate       && <Detail label="Joining Date"       value={row.joiningDate} />}
            {row.confirmationDate  && <Detail label="Confirmation Date"  value={row.confirmationDate} />}
            {row.siteLocation      && <Detail label="Location"           value={row.siteLocation} />}
            {row.attendanceCardNo  && <Detail label="Attendance Card No" value={row.attendanceCardNo} />}
          </div>
        </section>
      )}

      {(row.nid || row.gender || row.dateOfBirth || row.fatherName || row.presentAddress) && (
        <section className="rounded-md border border-border bg-card p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Personal</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {row.nid            && <Detail label="NID / ID Number"  value={row.nid} />}
            {row.gender         && <Detail label="Gender"          value={row.gender} />}
            {row.religion       && <Detail label="Religion"        value={row.religion} />}
            {row.bloodGroup     && <Detail label="Blood Group"     value={row.bloodGroup} />}
            {row.dateOfBirth    && <Detail label="Date Of Birth"   value={row.dateOfBirth} />}
            {row.fatherName     && <Detail label="Father Name"     value={row.fatherName} />}
            {row.motherName     && <Detail label="Mother Name"     value={row.motherName} />}
            {row.officialContact&& <Detail label="Official Contact" value={row.officialContact} />}
            {row.presentAddress && <Detail label="Present Address" value={row.presentAddress} />}
          </div>
        </section>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className="mt-0.5 text-sm text-foreground">{value}</div>
    </div>
  );
}

function UserCreate({ nextId, onSave }: { nextId: string; onSave: (u: UserRow) => void }) {
  return <UserFields mode="create" nextId={nextId} onSave={onSave} />;
}

/**
 * Shared User form fields. Used by the Create page (mode="create") and the
 * row Edit modal (mode="edit", pre-filled from `initial`) so both share an
 * identical layout. The Password card is create-only.
 */
function UserFields({
  mode, nextId, initial, onSave, onSubmit, onClose,
}: {
  mode: "create" | "edit";
  nextId?: string;
  initial?: UserRow;
  onSave?: (u: UserRow) => void;
  onSubmit?: (patch: Record<string, unknown>) => void;
  onClose?: () => void;
}) {
  const isEdit = mode === "edit";
  const [username, setUsername] = useState(initial?.username ?? "");
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [role, setRole] = useState<Role>(initial?.role ?? ROLES[0]);
  const [location, setLocation] = useState(initial?.location ?? "");   // Office
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // ── HR / employee profile ────────────────────────────────────────────────
  const [designation, setDesignation] = useState(initial?.designation ?? "");
  const [hrPosition, setHrPosition] = useState(initial?.hrPosition ?? "");
  const [employeeType, setEmployeeType] = useState(initial?.employeeType ?? "");
  const [joiningDate, setJoiningDate] = useState(initial?.joiningDate ?? new Date().toISOString().slice(0, 10));
  const [confirmationDate, setConfirmationDate] = useState(initial?.confirmationDate ?? "");
  const [siteLocation, setSiteLocation] = useState(initial?.siteLocation ?? "");
  const [attendanceCardNo, setAttendanceCardNo] = useState(initial?.attendanceCardNo ?? "");
  const [department, setDepartment] = useState(initial?.department ?? "");
  const [departmentSection, setDepartmentSection] = useState(initial?.departmentSection ?? "");
  const [religion, setReligion] = useState(initial?.religion ?? "");
  const [gender, setGender] = useState(initial?.gender ?? "");
  const [bloodGroup, setBloodGroup] = useState(initial?.bloodGroup ?? "");
  const [fatherName, setFatherName] = useState(initial?.fatherName ?? "");
  const [motherName, setMotherName] = useState(initial?.motherName ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(initial?.dateOfBirth ?? "");
  const [officialContact, setOfficialContact] = useState(initial?.officialContact ?? "");
  const [nid, setNid] = useState(initial?.nid ?? "");
  const [presentAddress, setPresentAddress] = useState(initial?.presentAddress ?? "");

  // Editable master lists for the +ADD NEW selects (persisted so additions stick).
  const [designations, setDesignations] = usePersistedState<string[]>("hr-designations", DESIGNATIONS);
  const [hrPositions, setHrPositions] = usePersistedState<string[]>("hr-positions", HR_POSITIONS);
  const [departments, setDepartments] = usePersistedState<string[]>("hr-departments", DEPARTMENTS);
  const [deptSections, setDeptSections] = usePersistedState<string[]>("hr-department-sections", DEPARTMENT_SECTIONS);

  // Multi-office / multi-warehouse system access. Warehouse choices cascade
  // from the offices the user is granted; changing offices prunes warehouses
  // that no longer belong to any granted office.
  const [officeAccess, setOfficeAccess] = useState<string[]>(initial?.officeAccess ?? []);
  const [warehouseAccess, setWarehouseAccess] = useState<string[]>(initial?.warehouseAccess ?? []);
  const whChoices = activeWarehouses.filter((w) => officeAccess.includes(w.officeId));
  const changeOffices = (ids: string[]) => {
    setOfficeAccess(ids);
    setWarehouseAccess((prev) =>
      prev.filter((wid) => {
        const w = warehouses.find((x) => x.id === wid);
        return w ? ids.includes(w.officeId) : false;
      }),
    );
  };
  const [active, setActive] = useState(initial ? initial.status === "Active" : true);

  const save = () => {
    if (!fullName.trim()) { toast.error("Name is required."); return; }
    if (!username.trim()) { toast.error("Username is required."); return; }
    if (!phone.trim()) { toast.error("Mobile No is required."); return; }
    if (!designation) { toast.error("Designation is required."); return; }
    if (!employeeType) { toast.error("Employee Type is required."); return; }
    if (!location) { toast.error("Office is required."); return; }
    if (!joiningDate) { toast.error("Joining Date is required."); return; }
    if (!nid.trim()) { toast.error("NID / ID Number is required."); return; }
    if (!isEdit) {
      if (!password) { toast.error("Password is required."); return; }
      if (password.length < 6) { toast.error("Password must be at least 6 characters."); return; }
      if (password !== confirm) { toast.error("Passwords do not match."); return; }
    }

    const payload = {
      username: username.trim().toLowerCase(),
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      role,
      location,
      status: (active ? "Active" : "Inactive") as "Active" | "Inactive",
      designation,
      hrPosition,
      employeeType,
      joiningDate,
      confirmationDate,
      siteLocation: siteLocation.trim(),
      attendanceCardNo: attendanceCardNo.trim(),
      department,
      departmentSection,
      religion,
      gender,
      bloodGroup,
      fatherName: fatherName.trim(),
      motherName: motherName.trim(),
      dateOfBirth,
      officialContact: officialContact.trim(),
      nid: nid.trim(),
      presentAddress: presentAddress.trim(),
      officeAccess,
      warehouseAccess,
    };
    if (isEdit) {
      onSubmit?.(payload);
      onClose?.();
    } else {
      onSave?.({ ...payload, id: nextId!, lastLogin: "—" });
      toast.success(`User "${fullName.trim()}" created.`);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider">Profile</h3>
            {!isEdit && <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save</Button>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">User ID</Label>
              <Input value={initial?.id ?? nextId ?? ""} disabled className="mt-1 font-mono" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Username <span className="text-destructive">*</span></Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} className="mt-1 font-mono" placeholder="e.g. r.hossain" />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Full Name <span className="text-destructive">*</span></Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Email <span className="text-destructive">*</span></Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" placeholder="user@us-bangla.com" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Mobile No <span className="text-destructive">*</span></Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" placeholder="+880 1XXX-XXXXXX" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Employment details */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-6">
            <Briefcase className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">Employment Details</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
            <AddableSelect label="Designation" required value={designation} onChange={setDesignation}
              options={designations} onAddOption={(v) => setDesignations((p) => [...p, v])} />
            <AddableSelect label="HR Position" value={hrPosition} onChange={setHrPosition}
              options={hrPositions} onAddOption={(v) => setHrPositions((p) => [...p, v])} />
            <PlainSelect label="Employee Type" required value={employeeType} onChange={setEmployeeType} options={EMPLOYEE_TYPES} />
            <PlainSelect label="Office" required value={location} onChange={setLocation} options={LOCATIONS} />

            <Field label="Joining Date" required type="date" value={joiningDate} onChange={setJoiningDate} />
            <Field label="Confirmation Date" type="date" value={confirmationDate} onChange={setConfirmationDate} />
            <Field label="Location" value={siteLocation} onChange={setSiteLocation} placeholder="Location" />
            <Field label="Attendance Device / Card No" value={attendanceCardNo} onChange={setAttendanceCardNo} placeholder="Card No" />

            <AddableSelect label="Department" value={department} onChange={setDepartment}
              options={departments} onAddOption={(v) => setDepartments((p) => [...p, v])} />
            <AddableSelect label="Department Section" value={departmentSection} onChange={setDepartmentSection}
              options={deptSections} onAddOption={(v) => setDeptSections((p) => [...p, v])} />
          </div>
        </CardContent>
      </Card>

      {/* Personal details */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-6">
            <IdCard className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">Personal Details</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
            <PlainSelect label="Religion" value={religion} onChange={setReligion} options={RELIGIONS} />
            <PlainSelect label="Gender" value={gender} onChange={setGender} options={GENDERS} />
            <PlainSelect label="Blood Group" value={bloodGroup} onChange={setBloodGroup} options={BLOOD_GROUPS} />
            <Field label="Date Of Birth" type="date" value={dateOfBirth} onChange={setDateOfBirth} />

            <Field label="Father Name" value={fatherName} onChange={setFatherName} placeholder="Father Name" />
            <Field label="Mother Name" value={motherName} onChange={setMotherName} placeholder="Mother Name" />
            <Field label="Official Contact" value={officialContact} onChange={setOfficialContact} placeholder="Official Contact" />
            <Field label="NID / Citizen / Civil / NIN / ID Number" required value={nid} onChange={setNid} placeholder="NID" />

            <div className="sm:col-span-2 lg:col-span-4">
              <Label className={labelCls}>Present Address</Label>
              <Input value={presentAddress} onChange={(e) => setPresentAddress(e.target.value)} placeholder="Present Address" className="mt-1" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">Access</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Role <span className="text-destructive">*</span></Label>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={selectCls}>
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div />

            <div>
              <Label className={labelCls}>Office Access</Label>
              <AntSelect
                mode="multiple"
                allowClear
                value={officeAccess}
                onChange={changeOffices}
                placeholder="Select one or more offices…"
                className="mt-1"
                style={{ width: "100%" }}
                optionFilterProp="label"
                options={activeOffices.map((o) => ({ label: `${o.code} — ${o.name}`, value: o.id }))}
              />
              <div className="mt-1 text-[11px] text-muted-foreground">User can access every office selected here.</div>
            </div>
            <div>
              <Label className={labelCls}>Warehouse Access</Label>
              <AntSelect
                mode="multiple"
                allowClear
                value={warehouseAccess}
                onChange={setWarehouseAccess}
                disabled={officeAccess.length === 0}
                placeholder={officeAccess.length === 0 ? "Select an office first…" : "Select one or more warehouses…"}
                className="mt-1"
                style={{ width: "100%" }}
                optionFilterProp="label"
                options={whChoices.map((w) => ({ label: `${w.code} — ${w.name}`, value: w.id }))}
              />
              <div className="mt-1 text-[11px] text-muted-foreground">Limited to warehouses under the granted offices.</div>
            </div>

            <div className="md:col-span-2 flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2.5">
              <div>
                <div className="text-sm font-medium text-foreground">Active on creation</div>
                <div className="text-[11px] text-muted-foreground">User can sign in immediately after the account is created.</div>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          </div>
        </CardContent>
      </Card>

      {!isEdit && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-6">
              <KeyRound className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold uppercase tracking-wider">Password</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Password <span className="text-destructive">*</span></Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" placeholder="At least 6 characters" />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Confirm Password <span className="text-destructive">*</span></Label>
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground">
              User will be prompted to change this password on first sign-in.
            </div>
          </CardContent>
        </Card>
      )}
      {isEdit && (
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save Changes</Button>
        </div>
      )}
    </div>
  );
}

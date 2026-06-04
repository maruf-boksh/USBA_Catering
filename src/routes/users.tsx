import { useState, type ReactNode } from "react";
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
} from "lucide-react";
import { KpiCard } from "@/components/common/KpiCard";
import { ROLES, type Role } from "@/lib/roles";
import { STAFF_SEED, type StaffMember } from "@/lib/staff";
import { rowEditors } from "@/lib/row-editors";
import { cn } from "@/lib/utils";
import { toast } from "sonner";


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
        />
      )}
    />
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
          <Detail label="Email"      value={<span className="inline-flex items-center gap-1.5"><Mail className="h-3 w-3 text-muted-foreground" /> {row.email}</span>} />
          <Detail label="Phone"      value={<span className="inline-flex items-center gap-1.5"><Phone className="h-3 w-3 text-muted-foreground" /> {row.phone}</span>} />
          <Detail label="Location"   value={row.location} />
          <Detail label="Last Login" value={<span className="font-mono text-xs text-muted-foreground">{row.lastLogin}</span>} />
        </div>
      </section>
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
  const [location, setLocation] = useState(initial?.location ?? LOCATIONS[0]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [active, setActive] = useState(initial ? initial.status === "Active" : true);

  const save = () => {
    if (!fullName.trim()) { toast.error("Full name is required."); return; }
    if (!username.trim()) { toast.error("Username is required."); return; }
    if (!email.trim()) { toast.error("Email is required."); return; }
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
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" placeholder="+880 1XXX-XXXXXX" />
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
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Primary Location</Label>
              <select value={location} onChange={(e) => setLocation(e.target.value)} className={selectCls}>
                {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
              </select>
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

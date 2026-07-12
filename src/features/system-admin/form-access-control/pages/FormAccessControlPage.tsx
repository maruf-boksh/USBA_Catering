import { useMemo, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Plus, ArrowLeft, Save, LockKeyhole, RotateCcw, Lock,
} from "lucide-react";
import { TENANTS } from "../data/orgHierarchy";
import { FORMS } from "../data/formRegistry";
import {
  type FormAccessRule, type FieldPermission,
  findConcern, findForm, findSubConcern, findTenant, defaultFieldsFor,
} from "../types/formAccessControl.types";

const ACTOR = "System Admin";
const ALL_SUB_CONCERNS = "__all__";

const selectCls =
  "w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 disabled:cursor-not-allowed";

function nextRuleId(rows: FormAccessRule[]): string {
  return `FAC-${String(rows.length + 1).padStart(3, "0")}`;
}

function scopeLabel(rule: FormAccessRule): string {
  const tenant = findTenant(TENANTS, rule.tenantCode)?.name ?? rule.tenantCode;
  const concern = findConcern(TENANTS, rule.tenantCode, rule.concernCode)?.name ?? rule.concernCode;
  const sub = rule.subConcernCode
    ? findSubConcern(TENANTS, rule.tenantCode, rule.concernCode, rule.subConcernCode)?.name ?? rule.subConcernCode
    : "All warehouses";
  return `${tenant} › ${concern} › ${sub}`;
}

export default function FormAccessControlPage() {
  const [rules, setRules] = usePersistedState<FormAccessRule[]>("config-form-access-control-rules", []);
  const [view, setView] = useState<"list" | "editor">("list");
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingRule = editingId ? rules.find((r) => r.id === editingId) ?? null : null;

  function openCreate() {
    setEditingId(null);
    setView("editor");
  }
  function openEdit(rule: FormAccessRule) {
    setEditingId(rule.id);
    setView("editor");
  }
  function closeEditor() {
    setView("list");
    setEditingId(null);
  }

  function upsert(rule: FormAccessRule) {
    setRules((prev) => {
      const idx = prev.findIndex((r) => r.id === rule.id);
      if (idx === -1) return [rule, ...prev];
      const next = [...prev];
      next[idx] = rule;
      return next;
    });
  }
  function remove(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <>
      <PageHeader
        title="Form Access Control"
        subtitle="Control which fields are visible and mandatory on a form, per company / office / warehouse scope."
        actions={
          view === "list" ? (
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> New Rule</Button>
          ) : (
            <Button variant="outline" onClick={closeEditor}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          )
        }
      />

      {view === "list" && (
        <RuleList rules={rules} onView={openEdit} onEdit={openEdit} onDelete={remove} />
      )}
      {view === "editor" && (
        <RuleEditor
          key={editingId ?? "new"}
          rule={editingRule}
          allRules={rules}
          onSave={(r) => { upsert(r); closeEditor(); }}
          onCancel={closeEditor}
        />
      )}
    </>
  );
}

function RuleList({
  rules, onView, onEdit, onDelete,
}: {
  rules: FormAccessRule[];
  onView: (r: FormAccessRule) => void;
  onEdit: (r: FormAccessRule) => void;
  onDelete: (id: string) => void;
}) {
  const cols: Column<FormAccessRule>[] = [
    { key: "id", header: "Rule #" },
    {
      key: "formKey",
      header: "Form",
      render: (r) => findForm(FORMS, r.formKey)?.name ?? r.formKey,
    },
    {
      key: "tenantCode",
      header: "Scope",
      render: (r) => <span className="text-xs">{scopeLabel(r)}</span>,
    },
    {
      key: "fields",
      header: "Fields",
      render: (r) => {
        const visible = r.fields.filter((f) => f.visible).length;
        const mandatory = r.fields.filter((f) => f.mandatory).length;
        return (
          <span className="text-xs text-muted-foreground">
            {visible}/{r.fields.length} visible · {mandatory} mandatory
          </span>
        );
      },
    },
    {
      key: "updatedAt",
      header: "Last Updated",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.updatedAt} <span className="opacity-70">by {r.updatedBy}</span>
        </span>
      ),
    },
  ];

  return (
    <DataTable
      title="form access rules"
      data={rules}
      columns={cols}
      searchKeys={["id", "formKey", "tenantCode", "concernCode"]}
      selectable={false}
      actions={(r) => (
        <RowActions
          row={r}
          actions={["view", "edit", "delete"]}
          onView={() => onView(r)}
          onEdit={() => onEdit(r)}
          onDelete={() => onDelete(r.id)}
        />
      )}
    />
  );
}

function RuleEditor({
  rule, allRules, onSave, onCancel,
}: {
  rule: FormAccessRule | null;
  allRules: FormAccessRule[];
  onSave: (r: FormAccessRule) => void;
  onCancel: () => void;
}) {
  const isEdit = !!rule;

  const [formKey, setFormKey] = useState(rule?.formKey ?? FORMS[0].key);
  const [tenantCode, setTenantCode] = useState(rule?.tenantCode ?? TENANTS[0].code);
  const [concernCode, setConcernCode] = useState(rule?.concernCode ?? TENANTS[0].concerns[0]?.code ?? "");
  const [subConcernCode, setSubConcernCode] = useState(rule?.subConcernCode ?? "");
  const [fields, setFields] = useState<FieldPermission[]>(
    rule?.fields ?? defaultFieldsFor(findForm(FORMS, formKey)!),
  );

  const form = findForm(FORMS, formKey)!;
  const tenant = findTenant(TENANTS, tenantCode);
  const concern = findConcern(TENANTS, tenantCode, concernCode);

  const fieldDefByKey = useMemo(() => new Map(form.fields.map((f) => [f.key, f])), [form]);

  function changeForm(key: string) {
    setFormKey(key);
    setFields(defaultFieldsFor(findForm(FORMS, key)!));
  }
  function changeTenant(code: string) {
    // Cascading scope selection: changing tenant clears concern/sub-concern.
    setTenantCode(code);
    const t = findTenant(TENANTS, code);
    setConcernCode(t?.concerns[0]?.code ?? "");
    setSubConcernCode("");
  }
  function changeConcern(code: string) {
    // Cascading scope selection: changing concern clears sub-concern.
    setConcernCode(code);
    setSubConcernCode("");
  }

  function setVisible(fieldKey: string, next: boolean) {
    const def = fieldDefByKey.get(fieldKey);
    if (def?.locked && !next) return; // locked fields cannot be hidden
    setFields((prev) => prev.map((f) => {
      if (f.fieldKey !== fieldKey) return f;
      // Visibility cascades to mandatory: a hidden field cannot be required.
      return { ...f, visible: next, mandatory: next ? f.mandatory : false };
    }));
  }
  function setMandatory(fieldKey: string, next: boolean) {
    const def = fieldDefByKey.get(fieldKey);
    if (def?.locked && !next) return; // locked fields cannot be un-mandated
    setFields((prev) => prev.map((f) => (f.fieldKey === fieldKey ? { ...f, mandatory: next } : f)));
  }
  function resetToDefaults() {
    setFields(defaultFieldsFor(form));
    toast.message("Fields reset to registry defaults.");
  }

  function save() {
    if (!tenantCode || !concernCode) {
      toast.error("Company and Office are required.");
      return;
    }
    const duplicate = allRules.some((r) =>
      r.id !== rule?.id
      && r.formKey === formKey
      && r.tenantCode === tenantCode
      && r.concernCode === concernCode
      && r.subConcernCode === subConcernCode,
    );
    if (duplicate) {
      toast.error("A rule already exists for this exact form + scope combination.");
      return;
    }
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    onSave({
      id: rule?.id ?? nextRuleId(allRules),
      formKey,
      tenantCode,
      concernCode,
      subConcernCode,
      fields,
      updatedAt: now,
      updatedBy: ACTOR,
    });
    toast.success(`Saved access rule for ${form.name}.`);
  }

  const visibleCount = fields.filter((f) => f.visible).length;
  const mandatoryCount = fields.filter((f) => f.mandatory).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <LockKeyhole className="h-4 w-4" /> Scope
            </h3>
            {isEdit && (
              <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <Lock className="h-3 w-3" /> Scope is locked once a rule is created — only fields can be changed.
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Form <span className="text-destructive">*</span></Label>
              <select value={formKey} onChange={(e) => changeForm(e.target.value)} disabled={isEdit} className={selectCls}>
                {FORMS.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Company <span className="text-destructive">*</span></Label>
              <select value={tenantCode} onChange={(e) => changeTenant(e.target.value)} disabled={isEdit} className={selectCls}>
                {TENANTS.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Office <span className="text-destructive">*</span></Label>
              <select value={concernCode} onChange={(e) => changeConcern(e.target.value)} disabled={isEdit} className={selectCls}>
                {tenant?.concerns.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Warehouse</Label>
              <select
                value={subConcernCode || ALL_SUB_CONCERNS}
                onChange={(e) => setSubConcernCode(e.target.value === ALL_SUB_CONCERNS ? "" : e.target.value)}
                disabled={isEdit}
                className={selectCls}
              >
                <option value={ALL_SUB_CONCERNS}>All warehouses</option>
                {concern?.subConcerns.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">{form.description}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider">Field Permissions</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {visibleCount}/{fields.length} visible · {mandatoryCount} mandatory. Mandatory can only be toggled while a field is visible.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={resetToDefaults}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset to Defaults
            </Button>
          </div>

          <div className="rounded-md border border-border divide-y divide-border">
            {form.fields.map((def) => {
              const perm = fields.find((f) => f.fieldKey === def.key)!;
              return (
                <div key={def.key} className="flex items-center gap-4 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{def.label}</span>
                      {def.locked && (
                        <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-300 gap-1">
                          <Lock className="h-2.5 w-2.5" /> Locked
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono">{def.key}</div>
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground w-24 shrink-0">
                    <Switch checked={perm.visible} disabled={def.locked && perm.visible} onCheckedChange={(v) => setVisible(def.key, v)} />
                    Visible
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground w-28 shrink-0">
                    <Switch
                      checked={perm.mandatory}
                      disabled={!perm.visible || (def.locked && perm.mandatory)}
                      onCheckedChange={(v) => setMandatory(def.key, v)}
                    />
                    Mandatory
                  </label>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button onClick={save}><Save className="h-4 w-4 mr-1.5" /> Save Rule</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Org hierarchy (reference data) ────────────────────────────────────────
export type SubConcern = {
  code: string;
  name: string;
};

export type Concern = {
  code: string;
  name: string;
  subConcerns: SubConcern[];
};

export type Tenant = {
  code: string;
  name: string;
  concerns: Concern[];
};

// ─── Form registry (reference data) ────────────────────────────────────────
export type FormFieldDef = {
  key: string;
  label: string;
  defaultVisible: boolean;
  defaultMandatory: boolean;
  /** If true, admin cannot hide or un-mandate this field. */
  locked?: boolean;
};

export type FormDefinition = {
  key: string;
  name: string;
  description: string;
  fields: FormFieldDef[];
};

// ─── Field permission rule ──────────────────────────────────────────────────
export type FieldPermission = {
  fieldKey: string;
  visible: boolean;
  mandatory: boolean;
};

export type FormAccessRule = {
  id: string;
  formKey: string;
  tenantCode: string;
  concernCode: string;
  /** '' = applies to all sub-concerns under the concern. */
  subConcernCode: string;
  fields: FieldPermission[];
  updatedAt: string;
  updatedBy: string;
};

// ─── Repository / lookup helpers ────────────────────────────────────────────
export function findTenant(tenants: Tenant[], code: string): Tenant | undefined {
  return tenants.find((t) => t.code === code);
}

export function findConcern(tenants: Tenant[], tenantCode: string, concernCode: string): Concern | undefined {
  return findTenant(tenants, tenantCode)?.concerns.find((c) => c.code === concernCode);
}

export function findSubConcern(
  tenants: Tenant[],
  tenantCode: string,
  concernCode: string,
  subCode: string,
): SubConcern | undefined {
  return findConcern(tenants, tenantCode, concernCode)?.subConcerns.find((s) => s.code === subCode);
}

export function findForm(forms: FormDefinition[], key: string): FormDefinition | undefined {
  return forms.find((f) => f.key === key);
}

/**
 * Seed used whenever a new rule is started, and also what a "reset to
 * defaults" action restores.
 */
export function defaultFieldsFor(form: FormDefinition): FieldPermission[] {
  return form.fields.map((f) => ({
    fieldKey: f.key,
    visible: f.defaultVisible,
    mandatory: f.defaultMandatory,
  }));
}

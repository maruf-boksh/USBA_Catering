import { Select, Tag, Button } from "antd";
import {
  BankOutlined,
  HomeOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import {
  activeOffices,
  activeWarehousesByOffice,
  warehouses,
  offices,
} from "@/lib/sample-data";

/**
 * Mandatory Office + Warehouse picker for create forms.
 * Cascading: Warehouse list is filtered by the selected Office. Save-time
 * validation lives at the call site; this component only enforces the
 * cascade.
 */
export function LocationPicker({
  officeId,
  warehouseId,
  onChange,
  required = true,
  labelOffice = "Office",
  labelWarehouse = "Warehouse",
}: {
  officeId: string;
  warehouseId: string;
  onChange: (next: { officeId: string; warehouseId: string }) => void;
  required?: boolean;
  labelOffice?: string;
  labelWarehouse?: string;
}) {
  const officeChoices = activeOffices;
  const warehouseChoices = officeId ? activeWarehousesByOffice(officeId) : [];

  const handleOffice = (next: string) => {
    // Reset warehouse if it doesn't belong to the new office
    const stillValid = warehouses.some(
      (w) => w.id === warehouseId && w.officeId === next,
    );
    onChange({ officeId: next, warehouseId: stillValid ? warehouseId : "" });
  };

  return (
    <>
      <div>
        <div className="field-label" style={{ marginBottom: 4 }}>
          {labelOffice}{" "}
          {required && (
            <span style={{ color: "var(--color-destructive)" }}>*</span>
          )}
        </div>
        <Select
          value={officeId || undefined}
          onChange={handleOffice}
          placeholder="Select office"
          style={{ width: "100%" }}
          showSearch
          optionFilterProp="label"
          // Render the dropdown inside the dialog so a modal overlay (Radix
          // Dialog) doesn't block the options from being clicked.
          getPopupContainer={(trigger) => trigger.parentElement as HTMLElement}
          options={officeChoices.map((o) => ({
            value: o.id,
            label: `${o.code} — ${o.name}`,
          }))}
        />
      </div>
      <div>
        <div className="field-label" style={{ marginBottom: 4 }}>
          {labelWarehouse}{" "}
          {required && (
            <span style={{ color: "var(--color-destructive)" }}>*</span>
          )}
        </div>
        <Select
          value={warehouseId || undefined}
          onChange={(next: string) => onChange({ officeId, warehouseId: next })}
          placeholder={
            !officeId
              ? "Select office first"
              : warehouseChoices.length === 0
                ? "No warehouses"
                : "Select warehouse"
          }
          style={{ width: "100%" }}
          disabled={!officeId}
          showSearch
          optionFilterProp="label"
          getPopupContainer={(trigger) => trigger.parentElement as HTMLElement}
          options={warehouseChoices.map((w) => ({
            value: w.id,
            label: `${w.code} — ${w.name}`,
          }))}
        />
      </div>
    </>
  );
}

/**
 * Cascading filter row for list pages. Renders two compact pill controls
 * (Office + Warehouse) and a clear button. The Warehouse dropdown is filtered
 * by the selected Office.
 */
export function LocationFilter({
  officeId,
  warehouseId,
  onChange,
}: {
  officeId: string;
  warehouseId: string;
  onChange: (next: { officeId: string; warehouseId: string }) => void;
}) {
  const officeChoices = activeOffices;
  const warehouseChoices = officeId ? activeWarehousesByOffice(officeId) : [];

  const handleOffice = (next: string) => {
    const stillValid = warehouses.some(
      (w) => w.id === warehouseId && w.officeId === next,
    );
    onChange({ officeId: next, warehouseId: stillValid ? warehouseId : "" });
  };

  const clear = () => onChange({ officeId: "", warehouseId: "" });
  const anyActive = !!officeId || !!warehouseId;

  const pillBoxStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    padding: "4px 8px",
    boxShadow: "0 1px 2px 0 rgba(15, 23, 42, 0.04)",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div style={pillBoxStyle}>
        <BankOutlined style={{ color: "var(--color-muted-foreground)", fontSize: 12 }} />
        <span className="field-label">Office</span>
        <Select
          value={officeId || ""}
          onChange={(next: string) => handleOffice(next)}
          size="small"
          variant="borderless"
          style={{ minWidth: 120 }}
          options={[
            { value: "", label: "All" },
            ...officeChoices.map((o) => ({ value: o.id, label: o.name })),
          ]}
        />
      </div>
      <div style={pillBoxStyle}>
        <HomeOutlined style={{ color: "var(--color-muted-foreground)", fontSize: 12 }} />
        <span className="field-label">Warehouse</span>
        <Select
          value={warehouseId || ""}
          onChange={(next: string) => onChange({ officeId, warehouseId: next })}
          size="small"
          variant="borderless"
          disabled={!officeId}
          style={{ minWidth: 140 }}
          options={[
            { value: "", label: officeId ? "All" : "Pick office" },
            ...warehouseChoices.map((w) => ({ value: w.id, label: w.name })),
          ]}
        />
      </div>
      {anyActive && (
        <Button
          size="small"
          type="text"
          icon={<CloseOutlined />}
          onClick={clear}
          style={{ color: "var(--color-muted-foreground)" }}
        >
          Location
        </Button>
      )}
    </div>
  );
}

/**
 * Look up display names — used in list table cells when rendering tagged rows.
 * Returns "—" for empty / unknown ids so existing seed rows degrade gracefully.
 */
export function officeName(id: string | undefined | null): string {
  if (!id) return "—";
  return offices.find((o) => o.id === id)?.name ?? "—";
}
export function warehouseName(id: string | undefined | null): string {
  if (!id) return "—";
  return warehouses.find((w) => w.id === id)?.name ?? "—";
}

/**
 * Compact two-line label for table cells: Office on top, Warehouse below.
 */
export function LocationCell({
  officeId,
  warehouseId,
}: {
  officeId?: string;
  warehouseId?: string;
}) {
  const o = officeName(officeId);
  const w = warehouseName(warehouseId);
  if (o === "—" && w === "—") {
    return (
      <span style={{ color: "var(--color-muted-foreground)", fontSize: 12 }}>—</span>
    );
  }
  return (
    <div style={{ fontSize: 12, lineHeight: 1.3 }}>
      <div style={{ color: "var(--color-foreground)" }}>{o}</div>
      <div style={{ color: "var(--color-muted-foreground)" }}>{w}</div>
    </div>
  );
}

/**
 * Pill-style location badge — for compact row displays.
 */
export function LocationBadge({
  officeId: _officeId,
  warehouseId,
}: {
  officeId?: string;
  warehouseId?: string;
}) {
  const w = warehouseName(warehouseId);
  if (w === "—") return null;
  return (
    <Tag
      bordered
      style={{
        fontSize: 10,
        height: 20,
        padding: "0 6px",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        margin: 0,
        fontWeight: 400,
      }}
    >
      <HomeOutlined style={{ fontSize: 10 }} />
      {w}
    </Tag>
  );
}

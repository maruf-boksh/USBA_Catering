import { useState, useEffect, type ReactNode } from "react";
import { Dropdown, Button, Modal, Input } from "antd";
import type { MenuProps } from "antd";
import {
  MoreOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckOutlined,
  CloseOutlined,
  PrinterOutlined,
  DownloadOutlined,
  EnvironmentOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { toast } from "sonner";

type ActionKey =
  | "view"
  | "edit"
  | "delete"
  | "approve"
  | "reject"
  | "print"
  | "export"
  | "assign"
  | "track";

const META: Record<
  ActionKey,
  { label: string; icon: ReactNode; danger?: boolean }
> = {
  view:    { label: "View",         icon: <EyeOutlined /> },
  edit:    { label: "Edit",         icon: <EditOutlined /> },
  delete:  { label: "Delete",       icon: <DeleteOutlined />,    danger: true },
  approve: { label: "Approve",      icon: <CheckOutlined /> },
  reject:  { label: "Reject",       icon: <CloseOutlined />,     danger: true },
  print:   { label: "Print",        icon: <PrinterOutlined /> },
  export:  { label: "Export",       icon: <DownloadOutlined /> },
  assign:  { label: "Assign",       icon: <UserAddOutlined /> },
  track:   { label: "Track Status", icon: <EnvironmentOutlined /> },
};

type ModalKind = null | "view" | "edit" | "delete" | "approve" | "reject";

/** API handed to a render-prop `editDetail` so a custom form can persist + close. */
export type EditApi = {
  /** Persist a patch of changed fields (merged onto the row via onSave). */
  save: (patch: Record<string, unknown>) => void;
  /** Close the modal without saving. */
  close: () => void;
};

// A handful of field keys read better as fixed acronyms than as naive
// title-casing ("Iata" → "IATA", "id" → "ID").
const ACRONYMS: Record<string, string> = {
  id: "ID",
  iata: "IATA",
  icao: "ICAO",
  poref: "PO Ref",
  rfqref: "RFQ Ref",
  prref: "PR Ref",
  grnref: "GRN Ref",
  uom: "UoM",
  hsn: "HSN",
  vat: "VAT",
  gst: "GST",
  sku: "SKU",
};

/** Turn a camelCase / snake_case key into a readable label. */
function humanizeKey(key: string): string {
  const lower = key.toLowerCase();
  if (ACRONYMS[lower]) return ACRONYMS[lower];
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    // "officeId" → "office" (drop a trailing Id; it's an internal reference)
    .replace(/\bId\b/g, "")
    .trim();
  return (spaced || key).replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Human-readable rendering of a field value for the View modal. */
function formatValue(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    const allPrimitive = v.every((x) => typeof x !== "object" || x === null);
    if (allPrimitive) return v.join(", ");
    return `${v.length} item${v.length === 1 ? "" : "s"}`;
  }
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return "—"; }
  }
  return String(v);
}

/** Only primitive scalars are safely editable in the generic edit form. */
function isEditable(v: unknown): boolean {
  return v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/**
 * Re-assemble an updated row from the edited draft, preserving the original
 * value types (numbers stay numbers, booleans stay booleans). Non-editable
 * fields (arrays / objects) pass through untouched.
 */
function buildUpdated(
  original: Record<string, unknown>,
  draft: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...original };
  for (const [k, orig] of Object.entries(original)) {
    if (!(k in draft)) continue;
    const d = draft[k];
    if (typeof orig === "number") {
      out[k] = d.trim() === "" ? orig : Number(d);
    } else if (typeof orig === "boolean") {
      out[k] = /^(true|yes|1|active)$/i.test(d.trim());
    } else {
      out[k] = d;
    }
  }
  return out;
}

export function RowActions({
  row,
  actions = ["view", "edit", "approve", "delete"],
  detail,
  editDetail,
  onView,
  onEdit,
  onSave,
  onDelete,
}: {
  row: Record<string, unknown>;
  actions?: ActionKey[];
  detail?: ReactNode;
  /**
   * Custom Edit body. Either a static node (no built-in persistence — relies on
   * the footer "Save Changes" + onSave) OR a render-prop that receives a
   * `{ save, close }` API so a rich form can own its own Save button and persist
   * a patch. When a function is passed, the modal hides its default Save button.
   */
  editDetail?: ReactNode | ((api: EditApi) => ReactNode);
  /** When provided, View is handled by the page instead of the built-in modal. */
  onView?: (row: Record<string, unknown>) => void;
  /** When provided, Edit is handled by the page instead of the built-in modal. */
  onEdit?: (row: Record<string, unknown>) => void;
  /**
   * When provided, the generic Edit modal persists changes by calling this with
   * the updated row (the page should write it back into its state). Without it,
   * the modal falls back to a toast only (no persistence).
   */
  onSave?: (updatedRow: Record<string, unknown>) => void;
  /** When provided, Delete removes the record by calling this with the row. */
  onDelete?: (row: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState<ModalKind>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const rowId = String(row.id ?? "record");

  // Seed the edit draft (string values for inputs) whenever the edit modal opens.
  useEffect(() => {
    if (open === "edit") {
      const seed: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        if (isEditable(v)) seed[k] = v == null ? "" : String(v);
      }
      setDraft(seed);
    }
  }, [open, row]);

  const handle = (a: ActionKey) => {
    if (a === "view" && onView) { onView(row); return; }
    if (a === "edit" && onEdit) { onEdit(row); return; }
    if (a === "view" || a === "edit" || a === "delete" || a === "approve" || a === "reject") {
      setOpen(a);
      return;
    }
    if (a === "print")  { window.print(); return; }
    if (a === "export") { toast.success(`Exporting ${rowId}`); return; }
    if (a === "assign") { toast.success(`Assigned ${rowId}`); return; }
    if (a === "track")  { toast.info(`Tracking ${rowId}`); return; }
  };

  // Build menu items, inserting a divider before destructive actions when
  // they are not the first item (mirrors the legacy shadcn behavior).
  const menuItems: MenuProps["items"] = [];
  actions.forEach((a, i) => {
    const m = META[a];
    if ((a === "delete" || a === "reject") && i > 0) {
      menuItems.push({ type: "divider" });
    }
    menuItems.push({
      key: a,
      icon: m.icon,
      label: m.label,
      danger: m.danger,
      onClick: () => handle(a),
    });
  });

  const close = () => {
    setOpen(null);
    setRejectionReason("");
  };

  const titles: Record<Exclude<ModalKind, null>, string> = {
    view:    `Record Details — ${rowId}`,
    edit:    `Edit Record — ${rowId}`,
    delete:  `Confirm Delete — ${rowId}`,
    approve: `Approve — ${rowId}`,
    reject:  `Reject — ${rowId}`,
  };

  const editIsRenderProp = typeof editDetail === "function";
  const isDetailMode = (open === "view" && detail) || (open === "edit" && !!editDetail);
  const modalWidth = isDetailMode ? 960 : 680;

  // Render-prop editDetail owns its own Save; route its `save` through onSave.
  const editApi: EditApi = {
    save: (patch) => {
      if (onSave) onSave({ ...row, ...patch });
      toast.success(`Saved ${rowId}`);
      close();
    },
    close,
  };

  const saveEdit = () => {
    if (onSave) {
      onSave(buildUpdated(row, draft));
      toast.success(`Saved ${rowId}`);
    } else {
      toast.success(`Saved ${rowId}`);
    }
    close();
  };

  const confirmDelete = () => {
    if (onDelete) {
      onDelete(row);
      toast.success(`Deleted ${rowId}`);
    } else {
      toast.success(`Deleted ${rowId}`);
    }
    close();
  };

  const entries = Object.entries(row);

  return (
    <>
      <Dropdown
        menu={{ items: menuItems }}
        trigger={["click"]}
        placement="bottomRight"
      >
        <Button
          type="text"
          icon={<MoreOutlined />}
          size="small"
          aria-label="Row actions"
        />
      </Dropdown>

      <Modal
        open={!!open}
        title={open ? titles[open] : ""}
        onCancel={close}
        width={modalWidth}
        destroyOnHidden
        footer={
          // A render-prop edit form supplies its own Cancel / Save buttons, so
          // hide the modal's default footer entirely in that mode.
          open === "edit" && editIsRenderProp ? null : (
          <>
            {open !== "view" && (
              <Button onClick={close}>Cancel</Button>
            )}
            {open === "delete" && (
              <Button type="primary" danger onClick={confirmDelete}>
                Delete
              </Button>
            )}
            {open === "approve" && (
              <Button
                type="primary"
                onClick={() => { toast.success(`Approved ${rowId}`); close(); }}
              >
                Approve
              </Button>
            )}
            {open === "reject" && (
              <Button
                type="primary"
                danger
                onClick={() => { toast.success(`Rejected ${rowId}`); close(); }}
              >
                Reject
              </Button>
            )}
            {open === "edit" && !editIsRenderProp && (
              <Button type="primary" onClick={saveEdit}>
                Save Changes
              </Button>
            )}
            {open === "view" && (
              <Button type="primary" onClick={close}>Close</Button>
            )}
          </>
          )
        }
      >
        {open === "delete" && (
          <div style={{ color: "var(--color-muted-foreground)" }}>
            This action cannot be undone.
          </div>
        )}
        {open === "approve" && (
          <div style={{ color: "var(--color-muted-foreground)" }}>
            Approving will move this record to the next workflow stage.
          </div>
        )}
        {open === "reject" && (
          <>
            <div style={{ color: "var(--color-muted-foreground)", marginBottom: 8 }}>
              Rejection requires a reason and notifies the originator.
            </div>
            <Input.TextArea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Reason for rejection..."
              rows={4}
            />
          </>
        )}

        {open === "view" && detail && <div>{detail}</div>}
        {open === "edit" && editDetail && (
          <div>{editIsRenderProp ? (editDetail as (api: EditApi) => ReactNode)(editApi) : editDetail}</div>
        )}

        {/* Generic read-only View — humanized labels, formatted values. */}
        {open === "view" && !detail && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              maxHeight: 460,
              overflow: "auto",
            }}
          >
            {entries.map(([k, v]) => (
              <div
                key={k}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  background: "var(--color-muted, transparent)",
                }}
              >
                <div className="field-label">{humanizeKey(k)}</div>
                <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2, wordBreak: "break-word" }}>
                  {formatValue(v)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Generic Edit — editable scalar fields, non-editable shown read-only. */}
        {open === "edit" && !editDetail && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              maxHeight: 460,
              overflow: "auto",
            }}
          >
            {entries.map(([k, v]) => {
              const editable = isEditable(v);
              const locked = k === "id"; // never edit the primary key
              return (
                <div
                  key={k}
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    padding: "8px 10px",
                  }}
                >
                  <div className="field-label">{humanizeKey(k)}</div>
                  {editable && !locked ? (
                    <Input
                      value={draft[k] ?? ""}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [k]: e.target.value }))}
                      variant="borderless"
                      style={{ paddingInline: 0, marginTop: 2 }}
                    />
                  ) : (
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        marginTop: 2,
                        color: "var(--color-muted-foreground)",
                        wordBreak: "break-word",
                      }}
                      title={locked ? "Primary key — not editable" : "Not editable here"}
                    >
                      {formatValue(v)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </>
  );
}

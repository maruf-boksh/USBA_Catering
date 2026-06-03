import { useState, type ReactNode } from "react";
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

export function RowActions({
  row,
  actions = ["view", "edit", "approve", "delete"],
  detail,
  editDetail,
  onView,
  onEdit,
}: {
  row: Record<string, unknown>;
  actions?: ActionKey[];
  detail?: ReactNode;
  editDetail?: ReactNode;
  /** When provided, View is handled by the page instead of the built-in modal. */
  onView?: (row: Record<string, unknown>) => void;
  /** When provided, Edit is handled by the page instead of the built-in modal. */
  onEdit?: (row: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState<ModalKind>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const rowId = String(row.id ?? "record");

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

  const isDetailMode = (open === "view" && detail) || (open === "edit" && editDetail);
  const modalWidth = isDetailMode ? 960 : 640;

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
          <>
            {open !== "view" && (
              <Button onClick={close}>Cancel</Button>
            )}
            {open === "delete" && (
              <Button
                type="primary"
                danger
                onClick={() => { toast.success(`Deleted ${rowId}`); close(); }}
              >
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
            {open === "edit" && (
              <Button
                type="primary"
                onClick={() => { toast.success(`Saved ${rowId}`); close(); }}
              >
                Save Changes
              </Button>
            )}
            {open === "view" && (
              <Button type="primary" onClick={close}>Close</Button>
            )}
          </>
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
        {open === "edit" && editDetail && <div>{editDetail}</div>}

        {(open === "view" || open === "edit") && !isDetailMode && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              maxHeight: 420,
              overflow: "auto",
            }}
          >
            {Object.entries(row).map(([k, v]) => (
              <div
                key={k}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  padding: 8,
                }}
              >
                <div className="field-label">{k}</div>
                {open === "edit" ? (
                  <Input
                    defaultValue={String(v)}
                    variant="borderless"
                    style={{ paddingInline: 0, marginTop: 2 }}
                  />
                ) : (
                  <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>
                    {String(v)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}

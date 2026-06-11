import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Table, Input, Button } from "antd";
import type { TableColumnType } from "antd";
import { SearchOutlined, DownloadOutlined } from "@ant-design/icons";
import { toast } from "sonner";
import { useLocation } from "react-router-dom";
import { resolveSelectedNavKey } from "@/layouts/AppLayout/navIndex";
import { useRole } from "@/lib/roles";
import { useAccess, canElement, can, registerElements, columnElementId } from "@/lib/access-control";

/**
 * Same external API as the legacy shadcn DataTable so the 54 consumer pages
 * keep working unchanged. Internals are Ant Table now, which gives us native
 * sorting / pagination / row selection — the only custom UI left is the
 * search input and bulk-action toolbar above the table.
 *
 * The `data-arrival-row-id` attribute is still emitted via Ant's onRow so the
 * dashboard arrival-flash highlight keeps working.
 */
export type Column<T> = {
  key: keyof T | string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
};

export function DataTable<T extends { id: string }>({
  columns,
  data,
  actions,
  searchKeys,
  pageSize = 8,
  title,
  selectable = true,
  flashRowId,
}: {
  columns: Column<T>[];
  data: T[];
  actions?: (row: T) => ReactNode;
  searchKeys?: (keyof T)[];
  pageSize?: number;
  title?: string;
  selectable?: boolean;
  /** When set, the table jumps to the page holding this row id so a deep-link
   *  arrival highlight (see arrival-flash) can find and flash it. */
  flashRowId?: string;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  // ── Per-role column visibility (applies to every page using DataTable) ──────
  const { role } = useRole();
  const access = useAccess();
  const route = resolveSelectedNavKey(useLocation().pathname);

  // Register this table's columns so they appear in User Access Control.
  useEffect(() => {
    registerElements(
      route,
      columns.map((c) => ({ id: columnElementId(String(c.key)), label: `${c.header} column`, kind: "column" as const })),
    );
  }, [route, columns]);

  // Drop columns the current role may not view; bulk actions need "edit".
  const visibleColumns = useMemo(
    () => columns.filter((c) => canElement(role, route, columnElementId(String(c.key)), "view", access)),
    [columns, role, route, access],
  );
  const canBulk = can(role, route, "edit", access);

  const filtered = useMemo(() => {
    if (!q || !searchKeys) return data;
    const ql = q.toLowerCase();
    return data.filter((r) =>
      searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(ql)),
    );
  }, [data, q, searchKeys]);

  // Deep-link arrival: jump once to the page that holds the flash target so the
  // arrival-flash highlight can locate the row in the DOM. Runs per target id.
  const jumpedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!flashRowId || jumpedFor.current === flashRowId) return;
    const idx = filtered.findIndex((r) => r.id === flashRowId);
    if (idx >= 0) {
      setPage(Math.floor(idx / pageSize) + 1);
      jumpedFor.current = flashRowId;
    }
  }, [flashRowId, filtered, pageSize]);

  // Translate our Column<T> shape to Ant's TableColumnType<T>.
  // We deliberately strip `text-right` from column-level classNames so number
  // columns (qty, count, amount) stay left-aligned for the same visual rhythm
  // as the rest of the row. Individual cell renders can still right-align
  // their own content via inline classes if they really need to.
  const stripColumnAlignment = (cls?: string) => {
    if (!cls) return undefined;
    const next = cls.split(/\s+/).filter((c) => c !== "text-right" && c !== "text-center").join(" ");
    return next || undefined;
  };
  const antColumns: TableColumnType<T>[] = useMemo(() => {
    const cols: TableColumnType<T>[] = visibleColumns.map((c) => ({
      title: c.header,
      dataIndex: String(c.key),
      key: String(c.key),
      className: stripColumnAlignment(c.className),
      sorter:
        c.sortable === false
          ? undefined
          : (a: T, b: T) => {
              const av = String((a as Record<string, unknown>)[String(c.key)] ?? "");
              const bv = String((b as Record<string, unknown>)[String(c.key)] ?? "");
              return av.localeCompare(bv, undefined, { numeric: true });
            },
      render: c.render
        ? (_: unknown, row: T) => c.render!(row)
        : (_: unknown, row: T) => {
            const value = (row as Record<string, unknown>)[String(c.key)];
            return value == null ? "" : String(value);
          },
    }));
    if (actions) {
      cols.push({
        title: "Actions",
        key: "__actions__",
        width: 80,
        render: (_: unknown, row: T) => actions(row),
      });
    }
    return cols;
  }, [visibleColumns, actions]);

  const exportCsv = () => {
    const header = visibleColumns.map((c) => c.header).join(",");
    const rows = filtered.map((r) =>
      visibleColumns
        .map((c) => `"${String((r as Record<string, unknown>)[String(c.key)] ?? "")}"`)
        .join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title || "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported to CSV");
  };

  return (
    <div
      style={{
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        boxShadow: "0 1px 2px 0 rgba(15, 23, 42, 0.04)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 12,
          borderBottom: "1px solid var(--color-border)",
          flexWrap: "wrap",
        }}
      >
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: "var(--color-muted-foreground)" }} />}
          placeholder="Search..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: "1 1 200px", maxWidth: 320 }}
        />
        {selectable && canBulk && selected.length > 0 && (
          <>
            <span style={{ fontSize: 13, color: "var(--color-muted-foreground)" }}>
              {selected.length} selected
            </span>
            <Button
              size="small"
              onClick={() => {
                toast.success(`Bulk action on ${selected.length} rows`);
                setSelected([]);
              }}
            >
              Bulk Approve
            </Button>
          </>
        )}
        <div style={{ marginLeft: "auto" }}>
          <Button size="small" icon={<DownloadOutlined />} onClick={exportCsv}>
            Export
          </Button>
        </div>
      </div>

      <Table<T>
        rowKey="id"
        columns={antColumns}
        dataSource={filtered}
        size="small"
        pagination={{
          current: page,
          onChange: (p) => setPage(p),
          pageSize,
          showSizeChanger: false,
          showTotal: (total, range) => `Showing ${range[0]}–${range[1]} of ${total}`,
          size: "small",
          style: { padding: "8px 12px", margin: 0 },
        }}
        rowSelection={
          selectable
            ? {
                selectedRowKeys: selected,
                onChange: (keys) => setSelected(keys as string[]),
              }
            : undefined
        }
        // Preserve dashboard arrival-flash hook
        onRow={(row) => ({
          "data-arrival-row-id": row.id,
        } as React.HTMLAttributes<HTMLElement>)}
        locale={{
          emptyText: (
            <div
              style={{
                padding: "32px 0",
                textAlign: "center",
                color: "var(--color-muted-foreground)",
                fontSize: 13,
              }}
            >
              No records found
            </div>
          ),
        }}
      />
    </div>
  );
}

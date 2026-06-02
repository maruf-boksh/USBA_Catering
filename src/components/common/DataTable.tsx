import { useMemo, useState, type ReactNode } from "react";
import { Table, Input, Button } from "antd";
import type { TableColumnType } from "antd";
import { SearchOutlined, DownloadOutlined } from "@ant-design/icons";
import { toast } from "sonner";

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
}: {
  columns: Column<T>[];
  data: T[];
  actions?: (row: T) => ReactNode;
  searchKeys?: (keyof T)[];
  pageSize?: number;
  title?: string;
  selectable?: boolean;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const filtered = useMemo(() => {
    if (!q || !searchKeys) return data;
    const ql = q.toLowerCase();
    return data.filter((r) =>
      searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(ql)),
    );
  }, [data, q, searchKeys]);

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
    const cols: TableColumnType<T>[] = columns.map((c) => ({
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
  }, [columns, actions]);

  const exportCsv = () => {
    const header = columns.map((c) => c.header).join(",");
    const rows = filtered.map((r) =>
      columns
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
        {selectable && selected.length > 0 && (
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

import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable, type Column } from "@/components/common/DataTable";
import { RowActions } from "@/components/common/RowActions";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Wrench, Plus } from "lucide-react";
import { assets } from "@/lib/sample-data";
import { KpiCard } from "@/components/common/KpiCard";

type A = (typeof assets)[number];

export default function Maintenance() {
  const cols: Column<A>[] = [
    { key: "id", header: "Asset #" },
    { key: "name", header: "Name" },
    { key: "type", header: "Type" },
    { key: "location", header: "Location" },
    { key: "lastSvc", header: "Last Service" },
    { key: "nextSvc", header: "Next Service" },
    { key: "status", header: "Status", render: r => <StatusBadge status={r.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Maintenance & Assets"
        subtitle="Equipment register, preventive schedules, maintenance tickets"
        actions={<Button><Plus className="h-4 w-4 mr-1" /> New Ticket</Button>}
      />
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total Assets" value={184} icon={Wrench} tone="navy" />
        <KpiCard label="Operational" value={172} icon={Wrench} tone="success" />
        <KpiCard label="Service Due" value={8} icon={Wrench} tone="warning" />
        <KpiCard label="In Maintenance" value={4} icon={Wrench} tone="red" />
      </div>
      <DataTable
        title="assets"
        data={assets}
        columns={cols}
        searchKeys={["id", "name", "type", "location", "status"]}
        actions={(r) => <RowActions row={r} actions={["view", "edit", "assign", "track", "delete"]} />}
        selectable={false}
      />
    </>
  );
}

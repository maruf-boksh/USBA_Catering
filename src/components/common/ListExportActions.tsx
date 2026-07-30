import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import { exportTableCsv, printTable, type ExportTable } from "@/lib/list-export";

/**
 * The standard Export (CSV) + Print pair every list page carries — same look
 * and behaviour as the Galley Plan originals. `table` is a THUNK so the rows
 * are built from the page's current filtered data at click time, not on every
 * render.
 */
export function ListExportActions({ table }: { table: () => ExportTable }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => exportTableCsv(table())} title="Export the list to CSV (Excel)">
        <Download className="h-3.5 w-3.5 mr-1" /> Export
      </Button>
      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => printTable(table())} title="Print the list (PDF)">
        <Printer className="h-3.5 w-3.5 mr-1" /> Print
      </Button>
    </div>
  );
}

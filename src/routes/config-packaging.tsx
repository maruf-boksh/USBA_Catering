import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Printer, ScanLine, CheckCircle2, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  usePackagingCompletionSettings,
  setPackagingPrintScan,
} from "@/lib/packaging-completion-settings";

/** One mode explained — highlighted when it is the active one. */
function ModeCard({
  active, icon: Icon, title, steps,
}: {
  active: boolean;
  icon: typeof Printer;
  title: string;
  steps: string[];
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        active ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20 opacity-70",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
        <span className="text-sm font-semibold">{title}</span>
        {active && (
          <Badge className="text-[9px] ml-auto" variant="default">Active</Badge>
        )}
      </div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s} className="flex items-start gap-2 text-xs text-muted-foreground">
            <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold tabular-nums">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function ConfigPackagingPage() {
  const { printScan } = usePackagingCompletionSettings();

  const handleToggle = (on: boolean) => {
    setPackagingPrintScan(on);
    toast.success(
      on
        ? "Print & scan enabled — packaging completes by scanning printed labels."
        : "Print & scan disabled — batches are marked Packaging Done directly from the list.",
    );
  };

  return (
    <>
      <PageHeader
        title="Packaging Configuration"
        subtitle="How a packaging run is completed — via printed labels that are scanned, or by marking selected batches done directly on the list"
      />

      <Card className="mb-4">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="pkg-print-scan" className="text-xs uppercase tracking-wider text-muted-foreground">
                Label print &amp; scan
              </Label>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                {printScan
                  ? "On — labels must be printed and scanned; the scan is what marks a batch Packaging Done."
                  : "Off — no labels or scanner needed; ticked batches are marked Packaging Done directly."}
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <span className={cn("text-xs font-medium", printScan ? "text-primary" : "text-muted-foreground")}>
                {printScan ? "Enabled" : "Disabled"}
              </span>
              <Switch
                id="pkg-print-scan"
                checked={printScan}
                onCheckedChange={handleToggle}
                aria-label="Toggle label print & scan"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* What each mode looks like on the Packaging page, so the effect of the
          toggle is understood BEFORE flipping it. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ModeCard
          active={printScan}
          icon={ScanLine}
          title="Print & scan (with printer + scanner)"
          steps={[
            "Select batches on the Packaging list and open Print Labels.",
            "Print each label — reprint as many copies as needed.",
            "Scan a printed label to mark that batch Packaging Done (ready for dispatch).",
          ]}
        />
        <ModeCard
          active={!printScan}
          icon={PackageCheck}
          title="Direct completion (no printer / scanner)"
          steps={[
            "Select batches on the Packaging list.",
            "Mark Packaging Done — the selected batches complete immediately (ready for dispatch).",
          ]}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px]">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Both modes end in the same place: Packaging Done → dispatch manifest → order lifecycle. Only the completion step changes.
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          Safe to switch mid-day — batches already completed stay completed; batches In Packaging complete via the new mode.
        </Badge>
      </div>
    </>
  );
}

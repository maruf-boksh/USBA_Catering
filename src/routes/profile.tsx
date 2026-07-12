import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  UserRound, Mail, IdCard, ShieldCheck, Pencil, LogOut, CheckCircle2,
} from "lucide-react";
import { getAuthUser, clearAuthUser } from "@/lib/auth";
import { useRole } from "@/lib/roles";
import { useAllRoles } from "@/lib/access-control";

/** Two-letter initials from a display name (e.g. "R. Hossain" → "RH"). */
function initials(name: string): string {
  const parts = name.replace(/[.]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const user = getAuthUser();
  const { role: actingRole } = useRole();
  const allRoles = useAllRoles();

  const name = user?.name ?? "Unknown User";
  const email = user?.email ?? "—";
  const userId = user?.userId ?? "—";
  const primaryRole = user?.role ?? actingRole;

  const roleList = useMemo(() => {
    // Show every role this account can act as, primary first, de-duplicated.
    const set = new Set<string>([primaryRole, ...allRoles]);
    return Array.from(set);
  }, [primaryRole, allRoles]);

  const handleSignOut = () => {
    clearAuthUser();
    navigate("/login");
  };

  return (
    <>
      <PageHeader
        title="My Profile"
        subtitle="Your account identity, role and access at a glance"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/account-settings")}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit Profile
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleSignOut}>
              <LogOut className="h-3.5 w-3.5 mr-1.5" /> Sign Out
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Identity card */}
        <Card className="lg:col-span-1">
          <CardContent className="pt-6 flex flex-col items-center text-center">
            <div
              className="h-20 w-20 rounded-full grid place-items-center text-2xl font-bold text-white shadow-sm"
              style={{ background: "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)" }}
            >
              {initials(name)}
            </div>
            <div className="mt-3 text-lg font-semibold">{name}</div>
            <div className="text-sm text-muted-foreground">{primaryRole}</div>
            <Badge variant="secondary" className="mt-3 gap-1 text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Active
            </Badge>
            <Separator className="my-4" />
            <div className="w-full space-y-2 text-sm">
              <InfoRow icon={Mail} label="Email" value={email} />
              <InfoRow icon={IdCard} label="User ID" value={userId} />
            </div>
          </CardContent>
        </Card>

        {/* Account details */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider">Account Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full Name" value={name} />
              <Field label="Email Address" value={email} />
              <Field label="User ID" value={userId} />
              <Field label="Primary Role" value={primaryRole} />
              <Field label="Acting Role" value={actingRole} />
              <Field label="Account Status" value="Active" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider">Roles & Access</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Roles this account can act as. Switch your acting role from the profile menu in the top bar.
              </p>
              <div className="flex flex-wrap gap-2">
                {roleList.map((r) => {
                  const isActing = r === actingRole;
                  return (
                    <span
                      key={r}
                      className={
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border " +
                        (isActing
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-muted/40 text-foreground/80")
                      }
                    >
                      {isActing ? <ShieldCheck className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}
                      {r}
                      {isActing && <span className="text-[10px] font-semibold uppercase tracking-wide">· current</span>}
                    </span>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-left">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium truncate">{value}</span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
    </div>
  );
}

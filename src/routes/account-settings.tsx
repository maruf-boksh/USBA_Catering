import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserRound, ShieldCheck, SlidersHorizontal, Moon, Save, Camera, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getAuthUser, setAuthUser, setStoredPhoto, validateCredentials, type AuthUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit-log";
import { useThemeStore } from "@/stores/themeStore";

const PREFS_KEY = "harvest-user-prefs-v1";

/** Two-letter initials from a display name (e.g. "R. Hossain" → "RH"). */
function initials(name: string): string {
  const parts = name.replace(/[.]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Read an image File and return a downscaled square-ish JPEG data URL. Resizing
 * to ≤ maxPx keeps the avatar well under the ~5 MB localStorage quota (a 256px
 * JPEG is ~10–30 KB) while staying crisp on the profile/topbar circles.
 */
function resizeImageToDataUrl(file: File, maxPx: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("no canvas context")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

type UserPrefs = {
  emailAlerts: boolean;
  approvalReminders: boolean;
  weeklyDigest: boolean;
};

const DEFAULT_PREFS: UserPrefs = {
  emailAlerts: true,
  approvalReminders: true,
  weeklyDigest: false,
};

function loadPrefs(): UserPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<UserPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export default function AccountSettingsPage() {
  const user = getAuthUser();

  // ── Profile form ───────────────────────────────────────────────────────────
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(user?.photoUrl);

  const onPickPhoto = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file."); return; }
    try {
      const dataUrl = await resizeImageToDataUrl(file, 256);
      setPhotoUrl(dataUrl);
      // Persist the photo IMMEDIATELY (durable per-user store + session), not just
      // on "Save Changes" — so it survives a reload / dev-server restart even if
      // the user never clicks Save. The durable store is the source of truth;
      // the session write is best-effort (ignored on quota).
      if (user) {
        setStoredPhoto(user.userId, dataUrl);
        try { setAuthUser({ ...user, photoUrl: dataUrl }); } catch { /* session quota — durable store still holds it */ }
        window.dispatchEvent(new Event("auth-user-updated"));
      }
      toast.success("Photo saved — it will persist across reloads.");
    } catch {
      toast.error("Couldn't read that image. Try a different file.");
    }
  };

  const saveProfile = () => {
    if (!name.trim()) { toast.error("Name can't be empty."); return; }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { toast.error("Enter a valid email address."); return; }
    if (!user) { toast.error("No signed-in user."); return; }
    const next: AuthUser = { ...user, name: name.trim(), email: email.trim(), photoUrl };
    try {
      // Persist the avatar to its durable, per-user store first so it survives
      // logout/login, then write the session object.
      setStoredPhoto(next.userId, photoUrl);
      setAuthUser(next);
    } catch {
      toast.error("Couldn't save — the image may be too large. Try a smaller photo.");
      return;
    }
    // Let the top-bar avatar and dashboard greeting refresh immediately.
    window.dispatchEvent(new Event("auth-user-updated"));
    logAudit({ action: "Updated", module: "Account", entity: next.userId, detail: "Profile details changed" });
    toast.success("Profile updated — your photo is saved and will persist.");
  };

  // ── Password form ──────────────────────────────────────────────────────────
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  const changePassword = () => {
    if (!user) { toast.error("No signed-in user."); return; }
    if (!validateCredentials(user.userId, currentPw)) {
      toast.error("Current password is incorrect.");
      return;
    }
    if (newPw.length < 6) { toast.error("New password must be at least 6 characters."); return; }
    if (newPw !== confirmPw) { toast.error("New password and confirmation don't match."); return; }
    logAudit({ action: "Changed Password", module: "Account", entity: user.userId, detail: "Account password updated" });
    setCurrentPw(""); setNewPw(""); setConfirmPw("");
    toast.success("Password changed.");
  };

  // ── Preferences ────────────────────────────────────────────────────────────
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const [prefs, setPrefs] = useState<UserPrefs>(loadPrefs);

  const updatePref = (key: keyof UserPrefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    toast.success("Preference saved.");
  };

  return (
    <>
      <PageHeader
        title="Account Settings"
        subtitle="Manage your profile, security and personal preferences"
      />

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="profile"><UserRound className="h-3.5 w-3.5 mr-1.5" /> Profile</TabsTrigger>
          <TabsTrigger value="security"><ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Security</TabsTrigger>
          <TabsTrigger value="preferences"><SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" /> Preferences</TabsTrigger>
        </TabsList>

        {/* ── Profile ─────────────────────────────────────────────────────── */}
        <TabsContent value="profile" className="mt-0">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider">Profile Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Profile picture — resized + stored as a data URL with the profile */}
              <div className="flex items-center gap-4">
                <div
                  className="h-20 w-20 rounded-full overflow-hidden grid place-items-center text-2xl font-bold text-white shadow-sm shrink-0"
                  style={{ background: "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%)" }}
                >
                  {photoUrl
                    ? <img src={photoUrl} alt="Profile" className="h-full w-full object-cover" />
                    : initials(name)}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent">
                      <Camera className="h-3.5 w-3.5" /> {photoUrl ? "Change photo" : "Upload photo"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => { onPickPhoto(e.target.files?.[0] ?? null); e.target.value = ""; }}
                      />
                    </label>
                    {photoUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          setPhotoUrl(undefined);
                          if (user) {
                            setStoredPhoto(user.userId, undefined);
                            try { setAuthUser({ ...user, photoUrl: undefined }); } catch { /* ignore */ }
                            window.dispatchEvent(new Event("auth-user-updated"));
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    PNG or JPG · square works best. Click <strong>Save Changes</strong> to apply.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full Name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email Address</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>User ID</Label>
                  <Input value={user?.userId ?? ""} disabled />
                </div>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Input value={user?.role ?? ""} disabled />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                User ID and role are managed by an administrator in User Management.
              </p>
              <div className="flex justify-end">
                <Button onClick={saveProfile}><Save className="h-3.5 w-3.5 mr-1.5" /> Save Changes</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Security ────────────────────────────────────────────────────── */}
        <TabsContent value="security" className="mt-0">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider">Change Password</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="cur">Current Password</Label>
                <Input id="cur" type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="new">New Password</Label>
                  <Input id="new" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="conf">Confirm New Password</Label>
                  <Input id="conf" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Use at least 6 characters.</p>
              <div className="flex justify-end">
                <Button onClick={changePassword}><ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Update Password</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Preferences ─────────────────────────────────────────────────── */}
        <TabsContent value="preferences" className="mt-0 space-y-4">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider">Appearance</CardTitle>
            </CardHeader>
            <CardContent>
              <PrefRow
                icon={<Moon className="h-4 w-4 text-muted-foreground" />}
                title="Dark Mode"
                desc={mode === "dark" ? "Dark theme is on" : "Switch to a darker interface"}
                checked={mode === "dark"}
                onChange={(v) => setMode(v ? "dark" : "light")}
              />
              <p className="text-xs text-muted-foreground mt-3">
                For colours, layout and typography, open the Theme Center from the top bar.
              </p>
            </CardContent>
          </Card>

          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wider">Notifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <PrefRow
                title="Email Alerts"
                desc="Receive important updates by email"
                checked={prefs.emailAlerts}
                onChange={(v) => updatePref("emailAlerts", v)}
              />
              <PrefRow
                title="Approval Reminders"
                desc="Notify me when items await my approval"
                checked={prefs.approvalReminders}
                onChange={(v) => updatePref("approvalReminders", v)}
              />
              <PrefRow
                title="Weekly Digest"
                desc="A summary of activity every week"
                checked={prefs.weeklyDigest}
                onChange={(v) => updatePref("weeklyDigest", v)}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function PrefRow({
  icon, title, desc, checked, onChange,
}: {
  icon?: React.ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        {icon}
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

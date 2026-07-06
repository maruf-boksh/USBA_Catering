import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { isAuthenticated, setAuthUser, validateCredentials } from "@/lib/auth";
import { LogoTile } from "@/components/AviationLogo";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// ── Inline SVG icon helpers ───────────────────────────────────────────────────
function Icon({ d, d2, size = 18, ...rest }: { d: string; d2?: string; size?: number; [k: string]: unknown }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
         {...rest}>
      <path d={d} />
      {d2 && <path d={d2} />}
    </svg>
  );
}

const ICONS = {
  user:      { d: "M5.5 19a6.5 6.5 0 0 1 13 0", d2: "M12 12m-3.4 0a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0 -6.8 0" },
  lock:      { d: "M8 10.5V8a4 4 0 0 1 8 0v2.5", d2: "M5 10.5h14a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5.5a2 2 0 0 1 2-2z" },
  eye:       { d: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z", d2: "M12 12m-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0" },
  eyeOff:    { d: "M9.6 5.8A8.6 8.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15.6 15.6 0 0 1-3.2 3.8M6.3 7.3A15.4 15.4 0 0 0 2.5 12S6 18.5 12 18.5a8.7 8.7 0 0 0 3.6-.76", d2: "M10 10a2.6 2.6 0 0 0 3.7 3.7M3.5 3.5l17 17" },
  mail:      { d: "M3 5.5h18a2.2 2.2 0 0 1 2.2 2.2v9.6A2.2 2.2 0 0 1 21 19.5H3a2.2 2.2 0 0 1-2.2-2.2V7.7A2.2 2.2 0 0 1 3 5.5z", d2: "m3.6 7 8.4 6 8.4-6" },
  arrow:     { d: "M5 12h13", d2: "m13 6 6 6-6 6" },
  arrowLeft: { d: "M19 12H6", d2: "m11 18-6-6 6-6" },
  rotateCcw: { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", d2: "M3 3v5h5" },
  shield:    { d: "M12 3 5 6v5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z", d2: "m9 11.5 2 2 4-4" },
  check:     { d: "m5 12.5 4.5 4.5L19 6.5" },
} as const;

// ── Left hero panel ───────────────────────────────────────────────────────────
function LeftPanel() {
  return (
    <div className="hc-left hc-treat-f">
      {/* Arcs / flight paths SVG */}
      {/* xMinYMax slice — anchors bottom-left so origin dot is always in frame */}
      <svg className="hc-arcs" viewBox="0 0 600 760" preserveAspectRatio="xMinYMax slice" fill="none">

        {/* Concentric range arcs from origin */}
        {[130, 250, 370, 490, 610].map((r) => (
          <circle key={r} cx="78" cy="732" r={r} stroke="rgba(255,90,90,.22)" strokeWidth="1.2" />
        ))}

        {/* ── Dotted route paths (IDs used by animateMotion mpath) ── */}
        <path id="hc-route-a" d="M78 732 Q318 320 540 210" stroke="rgba(255,160,160,.9)"  strokeWidth="1.8" strokeDasharray="3 8" strokeLinecap="round" />
        <path id="hc-route-b" d="M78 732 Q298 420 525 320" stroke="rgba(255,150,150,.72)" strokeWidth="1.6" strokeDasharray="3 8" strokeLinecap="round" />
        <path id="hc-route-c" d="M78 732 Q258 540 500 430" stroke="rgba(255,140,140,.55)" strokeWidth="1.5" strokeDasharray="3 8" strokeLinecap="round" />

        {/* ── Origin waypoint ── */}
        <circle cx="78" cy="732" r="16" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="1.2" className="hc-dot-ring" style={{ animationDelay: "0.9s" }} />
        <circle cx="78" cy="732" r="11" fill="none" stroke="rgba(255,255,255,.38)" strokeWidth="1.8" />
        <circle cx="78" cy="732" r="6.5" fill="#ffffff" />

        {/* ── Destination 1 — top route ── */}
        <circle cx="540" cy="210" r="10" fill="none" stroke="rgba(255,75,75,.4)"   strokeWidth="1"   className="hc-dot-ring" style={{ animationDelay: "0s" }} />
        <circle cx="540" cy="210" r="10" fill="none" stroke="rgba(255,75,75,.58)"  strokeWidth="1.5" />
        <circle cx="540" cy="210" r="6"  fill="#ff3f3f" />

        {/* ── Destination 2 — middle route ── */}
        <circle cx="525" cy="320" r="9"  fill="none" stroke="rgba(255,100,100,.38)" strokeWidth="1"   className="hc-dot-ring" style={{ animationDelay: "0.5s" }} />
        <circle cx="525" cy="320" r="9"  fill="none" stroke="rgba(255,100,100,.54)" strokeWidth="1.5" />
        <circle cx="525" cy="320" r="5.5" fill="#ff6060" />

        {/* ── Destination 3 — lower route ── */}
        <circle cx="500" cy="430" r="8"  fill="none" stroke="rgba(255,120,120,.32)" strokeWidth="1"   className="hc-dot-ring" style={{ animationDelay: "1.1s" }} />
        <circle cx="500" cy="430" r="8"  fill="none" stroke="rgba(255,120,120,.50)" strokeWidth="1.5" />
        <circle cx="500" cy="430" r="5"  fill="#ff8080" />

        {/* ── Plane A — glued to route-a ── */}
        <g style={{ filter: 'drop-shadow(0 0 5px rgba(255,120,120,.65))' }}>
          <animateMotion dur="7s" repeatCount="indefinite" rotate="auto"
            keyPoints="0;0;1" keyTimes="0;0.07;1"
            calcMode="spline" keySplines="0 0 1 1;0.42 0 0.58 1">
            <mpath href="#hc-route-a" />
          </animateMotion>
          <animate attributeName="opacity" values="0;1;1;0"
            keyTimes="0;0.07;0.93;1" dur="7s" repeatCount="indefinite" />
          <path fill="#fff" transform="scale(0.62)"
                d="M22 0 L6 2 L3 2.4 L-5 11 L-8 11 L-5 2.6 L-15 2.2 L-18 6 L-20 6 L-19 2 L-21 1.4 L-21 -1.4 L-19 -2 L-20 -6 L-18 -6 L-15 -2.2 L-5 -2.6 L-8 -11 L-5 -11 L3 -2.4 L6 -2 Z" />
        </g>

        {/* ── Plane B — glued to route-b ── */}
        <g style={{ filter: 'drop-shadow(0 0 5px rgba(255,120,120,.5))' }}>
          <animateMotion dur="7.8s" begin="1.1s" repeatCount="indefinite" rotate="auto"
            keyPoints="0;0;1" keyTimes="0;0.07;1"
            calcMode="spline" keySplines="0 0 1 1;0.42 0 0.58 1">
            <mpath href="#hc-route-b" />
          </animateMotion>
          <animate attributeName="opacity" values="0;1;1;0"
            keyTimes="0;0.07;0.93;1" dur="7.8s" begin="1.1s" repeatCount="indefinite" />
          <path fill="#ffd9d9" transform="scale(0.56)"
                d="M22 0 L6 2 L3 2.4 L-5 11 L-8 11 L-5 2.6 L-15 2.2 L-18 6 L-20 6 L-19 2 L-21 1.4 L-21 -1.4 L-19 -2 L-20 -6 L-18 -6 L-15 -2.2 L-5 -2.6 L-8 -11 L-5 -11 L3 -2.4 L6 -2 Z" />
        </g>

        {/* ── Plane C — glued to route-c ── */}
        <g style={{ filter: 'drop-shadow(0 0 5px rgba(255,120,120,.4))' }}>
          <animateMotion dur="8.6s" begin="2.3s" repeatCount="indefinite" rotate="auto"
            keyPoints="0;0;1" keyTimes="0;0.07;1"
            calcMode="spline" keySplines="0 0 1 1;0.42 0 0.58 1">
            <mpath href="#hc-route-c" />
          </animateMotion>
          <animate attributeName="opacity" values="0;1;1;0"
            keyTimes="0;0.07;0.93;1" dur="8.6s" begin="2.3s" repeatCount="indefinite" />
          <path fill="#ffc2c2" transform="scale(0.5)"
                d="M22 0 L6 2 L3 2.4 L-5 11 L-8 11 L-5 2.6 L-15 2.2 L-18 6 L-20 6 L-19 2 L-21 1.4 L-21 -1.4 L-19 -2 L-20 -6 L-18 -6 L-15 -2.2 L-5 -2.6 L-8 -11 L-5 -11 L3 -2.4 L6 -2 Z" />
        </g>
      </svg>

      <div className="hc-left-inner hc-editorial">
        {/* Logo + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LogoTile size={46} glow={false} />
          <span className="hc-wordmark">AeroGalley Catering</span>
        </div>

        {/* Editorial body */}
        <div className="hc-ed-body">
          <span className="hc-ed-kicker">— Gate to galley</span>
          <h2 className="hc-ed-hero">
            Plan every meal<br /><em>across&nbsp;every&nbsp;route.</em>
          </h2>
          <p className="hc-ed-lede">
            The single system behind flight orders, production, quality control and dispatch — engineered for the people who feed the sky.
          </p>
        </div>

        {/* Stats */}
        <div className="hc-ed-foot">
          <div className="hc-stats">
            {([["500+", "Flights / day"], ["24/7", "Operations"], ["100%", "HACCP"]] as const).map(([n, l]) => (
              <div key={l} className="hc-stat">
                <div className="hc-stat-n">{n}</div>
                <div className="hc-stat-l">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── OTP grid ──────────────────────────────────────────────────────────────────
function OtpGrid({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function handleChange(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const digit = e.target.value.replace(/\D/g, "").slice(-1);
    const next = [...value]; next[i] = digit; onChange(next);
    if (digit && i < 5) refs.current[i + 1]?.focus();
  }
  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowLeft"  && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
  }
  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6).split("");
    const next = Array(6).fill("");
    digits.forEach((d, idx) => { next[idx] = d; });
    onChange(next);
    setTimeout(() => refs.current[Math.min(digits.length, 5)]?.focus(), 0);
  }

  return (
    <div className="hc-otp-grid">
      {value.map((digit, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className={`hc-otp-input${digit ? " has-value" : ""}`}
        />
      ))}
    </div>
  );
}

// ── Right form panel ──────────────────────────────────────────────────────────
function RightPanel() {
  const navigate = useNavigate();

  const [step, setStep]             = useState<"creds" | "otp">("creds");
  const [userId, setUserId]         = useState("");
  const [password, setPassword]     = useState("");
  const [showPass, setShowPass]     = useState(false);
  const [capsOn, setCapsOn]         = useState(false);
  const [otp, setOtp]               = useState<string[]>(Array(6).fill(""));
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [countdown, setCountdown]   = useState(45);
  const [forgotOpen, setForgotOpen] = useState(false);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const firstOtpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAuthenticated()) navigate("/");
  }, [navigate]);

  function startCountdown() {
    if (timerRef.current) clearInterval(timerRef.current);
    setCountdown(45);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) { clearInterval(timerRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    if (step === "otp") {
      startCountdown();
      setTimeout(() => firstOtpRef.current?.querySelector("input")?.focus(), 60);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!userId.trim() || !password.trim()) {
      setError("Please enter your User ID and password.");
      return;
    }
    if (!validateCredentials(userId, password)) {
      setError("Invalid User ID or password. Try admin / admin123.");
      return;
    }
    setLoading(true);
    setTimeout(() => { setLoading(false); setStep("otp"); }, 700);
  }

  function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!otp.every((d) => d !== "")) { setError("Please enter all 6 digits of your OTP."); return; }
    setLoading(true);
    const user = validateCredentials(userId, password)!;
    setTimeout(() => {
      setAuthUser(user);
      setLoading(false);
      // Hand the welcome message off to the dashboard: the <Toaster> that should
      // display it lives in the authenticated shell, which isn't mounted yet.
      // Firing here would be lost, so stash it and let the dashboard show it on mount.
      try {
        sessionStorage.setItem(
          "welcome-toast",
          JSON.stringify({
            name: user.name,
            role: user.role,
          }),
        );
      } catch {
        /* ignore storage errors */
      }
      navigate("/");
    }, 700);
  }

  function handleResend() {
    if (countdown > 0) return;
    toast.info("OTP resent to your email.");
    startCountdown();
    setOtp(Array(6).fill(""));
  }

  const maskedEmail  = "md.h***@usbair.com";
  const countdownStr = `0:${String(countdown).padStart(2, "0")}`;

  return (
    <div className="hc-form-wrap">
      {/* ── STEP 1: Credentials ── */}
      {step === "creds" && (
        <form className="hc-form" onSubmit={handleCredentials} noValidate>
          {/* Logo tile */}
          <LogoTile size={48} glow={false} light />

          {/* Header */}
          <p className="hc-eyebrow" style={{ marginTop: 26 }}>Welcome back</p>
          <h1 className="hc-h1">Sign in to AeroGalley Catering</h1>
          <p className="hc-sub">Enter your credentials to access the catering workspace.</p>

          {/* Demo credentials hint */}
          <div style={{
            display: "flex", gap: 10, padding: "10px 12px", marginTop: 18, marginBottom: 4,
            borderRadius: 10, background: "#FFF0F0", border: "1px solid #FECACA",
            fontSize: 12, lineHeight: 1.5, color: "#E10101",
          }}>
            <Icon {...ICONS.shield} size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Demo credentials</div>
              <div>
                <code style={{ background: "rgba(225,1,1,0.12)", padding: "1px 6px", borderRadius: 4 }}>admin</code>
                {" / "}
                <code style={{ background: "rgba(225,1,1,0.12)", padding: "1px 6px", borderRadius: 4 }}>admin123</code>
                {" · "}
                <button
                  type="button"
                  onClick={() => { setUserId("admin"); setPassword("admin123"); }}
                  style={{ border: "none", background: "none", padding: 0, color: "#E10101", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                >
                  Fill
                </button>
              </div>
            </div>
          </div>

          {/* User ID field */}
          <div style={{ marginTop: 20 }}>
            <label className="hc-label">User ID</label>
            <div className={`hc-field${error && !userId.trim() ? " hc-err" : ""}`}>
              <span className="hc-field-ic"><Icon {...ICONS.user} size={17} /></span>
              <input
                type="text"
                autoComplete="username"
                placeholder="Enter your user ID"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="hc-input"
              />
            </div>
          </div>

          {/* Password field */}
          <div style={{ marginTop: 16 }}>
            <label className="hc-label">Password</label>
            <div className={`hc-field${error && !password.trim() ? " hc-err" : ""}`}>
              <span className="hc-field-ic"><Icon {...ICONS.lock} size={17} /></span>
              <input
                type={showPass ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setCapsOn(e.getModifierState?.("CapsLock") ?? false)}
                className="hc-input"
              />
              <button type="button" className="hc-eye" onClick={() => setShowPass((p) => !p)} tabIndex={-1}>
                <Icon {...(showPass ? ICONS.eyeOff : ICONS.eye)} size={17} />
              </button>
            </div>
          </div>

          {/* Caps lock hint + forgot password */}
          <div className="hc-subrow">
            <span className={`hc-caps-hint${capsOn ? " on" : ""}`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
              </svg>
              Caps Lock is on
            </span>
            <button type="button" className="hc-forgot" onClick={() => setForgotOpen(true)}>
              Forgot password?
            </button>
          </div>

          {/* Error hint */}
          <p className={`hc-err-hint${error ? " visible" : ""}`}>{error || " "}</p>

          {/* Submit */}
          <button type="submit" disabled={loading} className="hc-btn" style={{ marginTop: 4 }}>
            {loading ? (
              <span className="hc-spin" />
            ) : (
              <>
                <Icon {...ICONS.mail} size={17} />
                Continue with OTP
                <Icon {...ICONS.arrow} size={17} />
              </>
            )}
          </button>

          {/* Terms */}
          <p className="hc-terms">
            By signing in, you agree to AeroGalley Catering's{" "}
            <button type="button">Terms of Service</button>{" "}
            and <button type="button">Privacy Policy</button>.
          </p>
        </form>
      )}

      {/* ── STEP 2: OTP Verification ── */}
      {step === "otp" && (
        <form className="hc-form" onSubmit={handleVerifyOtp} noValidate>
          {/* Logo tile */}
          <LogoTile size={48} glow={false} light />

          {/* Header */}
          <p className="hc-eyebrow" style={{ marginTop: 26 }}>Email verification</p>
          <h1 className="hc-h1">Verify your OTP</h1>
          <p className="hc-sub">Enter the 6-digit code sent to your email.</p>

          {/* OTP banner */}
          <div className="hc-otp-banner" style={{ marginTop: 22 }}>
            <div className="hc-otp-banner-icon">
              <Icon {...ICONS.mail} size={16} />
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#1a0204", margin: "0 0 2px" }}>OTP sent to email</p>
              <p style={{ fontSize: 12, lineHeight: 1.6, color: "#6b6b72", margin: 0 }}>
                A 6-digit code was sent to <strong>{maskedEmail}</strong>. Check your inbox.
              </p>
            </div>
          </div>

          {/* OTP inputs */}
          <div ref={firstOtpRef} style={{ marginTop: 8 }}>
            <OtpGrid value={otp} onChange={setOtp} />
          </div>

          {/* Error hint */}
          <p className={`hc-err-hint${error ? " visible" : ""}`}>{error || " "}</p>

          {/* Submit */}
          <button type="submit" disabled={loading} className="hc-btn" style={{ marginTop: 4 }}>
            {loading ? (
              <span className="hc-spin" />
            ) : (
              <>
                <Icon {...ICONS.check} size={17} />
                Verify OTP
              </>
            )}
          </button>

          {/* Back + resend row */}
          <div className="hc-actions-row">
            <button
              type="button"
              className="hc-link-btn muted"
              onClick={() => { setStep("creds"); setOtp(Array(6).fill("")); setError(""); }}
            >
              <Icon {...ICONS.arrowLeft} size={14} />
              Back to credentials
            </button>
            <button
              type="button"
              className="hc-link-btn"
              disabled={countdown > 0}
              onClick={handleResend}
            >
              <Icon {...ICONS.rotateCcw} size={13} />
              {countdown > 0 ? `Resend in ${countdownStr}` : "Resend OTP"}
            </button>
          </div>

          {/* Terms */}
          <p className="hc-terms" style={{ marginTop: 20 }}>
            By signing in, you agree to AeroGalley Catering's{" "}
            <button type="button">Terms of Service</button>{" "}
            and <button type="button">Privacy Policy</button>.
          </p>
        </form>
      )}

      <span className="hc-build">Build HCERP 1.0</span>

      {/* Forgot Password Dialog */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: "linear-gradient(135deg,#ff2d2d,#E10101)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon {...ICONS.lock} size={15} style={{ color: "#fff" }} />
              </div>
              <div>
                <DialogTitle style={{ fontSize: 16, fontWeight: 700, color: "#1a0204", margin: 0 }}>
                  Forgot Password
                </DialogTitle>
                <p style={{ fontSize: 12, color: "#6b6b72", margin: 0 }}>Password recovery assistance</p>
              </div>
            </div>
          </DialogHeader>
          <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.7, marginTop: 4 }}>
            Please contact your system administrator or IT support team to reset your
            password. You can also reach out to{" "}
            <span style={{ fontWeight: 600, color: "#E10101" }}>md.hossain@usbair.com</span>{" "}
            for assistance. Include your User ID in the request.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button
              onClick={() => setForgotOpen(false)}
              style={{
                height: 34, padding: "0 20px", borderRadius: 8, border: "none",
                background: "linear-gradient(120deg,#ff2d2d,#E10101)",
                color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              Got it
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────────────────────────
export default function LoginPage() {
  return (
    <div className="hc-page">
      <LeftPanel />
      <RightPanel />
    </div>
  );
}

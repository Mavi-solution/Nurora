"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase, supabaseProblem } from "@/lib/supabase";

/*
 * The sign-in screen, rebuilt from the one this app used before the
 * rewrite: brand panel on the left, form on the right, collapsing to the
 * form alone below 1024px.
 *
 * The palette and type are the original design tokens, written here as
 * literals. The rest of the app ships its own reset and no stylesheet, so
 * pulling Tailwind back in for one screen would put its preflight on top
 * of that reset and change how every other screen renders.
 */
const T = {
  bg: "#f0f1ea",
  bgSubtle: "#e8eae1",
  card: "#ffffff",
  cardMuted: "#f7f8f3",
  border: "#dfe2d8",
  borderStrong: "#c8cdbe",
  text: "#2c3a36",
  muted: "#66736c",
  faint: "#939e96",
  brand300: "#9db4b1",
  brand600: "#3d5b59",
  brand700: "#334b49",
  danger: "#b42318",
  success: "#2f4a2c",
};

const DISPLAY = "var(--font-fraunces), ui-serif, Georgia, serif";
const SANS = "var(--font-inter), ui-sans-serif, system-ui, sans-serif";

const SELLING_POINTS = [
  "Availability rules that respect your timezone",
  "Start a timer, log the real session length",
  "Invoice per session, settled and tracked",
];

/* ------------------------------------------------------- biometrics */
/*
 * WebAuthn against the device's own sensor — Face ID, Touch ID, a
 * fingerprint reader, Windows Hello.
 *
 * There is no server here that verifies signed challenges, so this is NOT
 * a second factor and it cannot create a session on its own. What it does
 * is gate re-entry: the Supabase session already persists on this device,
 * and turning this on means the app will not open from that stored
 * session until the sensor says it is still you. If the session has
 * expired, the password is the only way back in — which is why the unlock
 * screen always offers it.
 */
const CRED_KEY = "nurora:webauthn:v1";
const LOCK_KEY = "nurora:lock:v1";

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window, or storage is full — biometrics just stays off */
  }
}

async function biometricSupported() {
  try {
    if (typeof window === "undefined") return false;
    if (!window.PublicKeyCredential || !navigator.credentials) return false;
    // Requires a secure context. http://localhost counts; plain http on a
    // LAN address does not, and neither does a sandboxed preview iframe.
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// What this device actually calls it, so the button doesn't offer Face ID
// to someone holding an Android phone.
function biometricName() {
  if (typeof navigator === "undefined") return "biometrics";
  const ua = navigator.userAgent || "";
  const apple = /iPhone|iPad|iPod|Macintosh/.test(ua);
  if (apple) {
    // Face ID on the notch-era iPhones and iPads Pro, Touch ID elsewhere.
    // There is no API that tells them apart, so name both.
    return /iPhone|iPad|iPod/.test(ua) ? "Face ID" : "Touch ID";
  }
  if (/Android/.test(ua)) return "fingerprint";
  if (/Windows/.test(ua)) return "Windows Hello";
  return "biometrics";
}

function bufferToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBuffer(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const str = atob(b64 + pad);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes.buffer;
}

async function registerBiometric(email, displayName) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Nurora" }, // no id: defaults to this origin, which is what we want
      user: { id: userId, name: email, displayName: displayName || email },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
      attestation: "none",
    },
  });
  if (!cred) throw new Error("no credential");
  return cred.rawId ? bufferToB64url(cred.rawId) : cred.id;
}

async function verifyBiometric(credId) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: b64urlToBuffer(credId), type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  return !!assertion;
}

/* ------------------------------------------------------------ pieces */
function Tick() {
  return (
    <span style={{
      marginTop: 3, width: 16, height: 16, borderRadius: 999, flexShrink: 0,
      background: T.brand600, color: "#fff", display: "grid", placeItems: "center",
      fontSize: 10, lineHeight: 1,
    }}>✓</span>
  );
}

function Alert({ tone, children }) {
  const tones = {
    error: { bg: "#fdf2f1", border: "#f3d4d0", color: T.danger },
    success: { bg: "#f2f7ef", border: "#d7e6cd", color: T.success },
    info: { bg: T.cardMuted, border: T.border, color: T.muted },
  };
  const s = tones[tone] || tones.info;
  return (
    <div role={tone === "error" ? "alert" : "status"} style={{
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
      borderRadius: 12, padding: "11px 14px", fontSize: 13.5, lineHeight: 1.5,
    }}>{children}</div>
  );
}

const fieldStyle = {
  width: "100%", boxSizing: "border-box", height: 44, padding: "0 14px",
  borderRadius: 12, border: `1px solid ${T.border}`, background: T.card,
  fontSize: 15, color: T.text, fontFamily: SANS, outline: "none",
};

function Label({ htmlFor, children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
      <label htmlFor={htmlFor} style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{children}</label>
      {right}
    </div>
  );
}

function PrimaryButton({ busy, children, ...rest }) {
  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      style={{
        width: "100%", height: 44, borderRadius: 999, border: "none",
        background: T.brand600, color: "#fff", fontSize: 14.5, fontWeight: 500,
        fontFamily: SANS, cursor: busy || rest.disabled ? "default" : "pointer",
        opacity: busy || rest.disabled ? 0.6 : 1, transition: "opacity .15s ease",
      }}
    >{busy ? "One moment…" : children}</button>
  );
}

/* ============================================================== login */
export default function NuroraLogin({ onAuthenticated }) {
  const configProblem = supabaseProblem();
  const supabase = getSupabase();

  // "signin" | "signup" | "unlock"
  const [screen, setScreen] = useState("signin");
  const [checking, setChecking] = useState(true);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [bioReady, setBioReady] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioLabel, setBioLabel] = useState("biometrics");
  // Set after a password sign-in when this device could hold a credential
  // but doesn't yet — {session} while we ask whether to turn it on.
  const [offerBio, setOfferBio] = useState(null);

  const lockedEmail = useRef("");

  useEffect(() => { setBioLabel(biometricName()); }, []);
  useEffect(() => { biometricSupported().then(setBioReady); }, []);

  const enter = useCallback((session) => {
    onAuthenticated(session);
  }, [onAuthenticated]);

  /*
   * On load: if a session is already stored and this device has biometrics
   * armed, hold at the unlock screen. Otherwise go straight in — the
   * session is valid and nothing was asked for.
   */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) { setChecking(false); return; }
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      const session = data?.session || null;
      if (!session) { setChecking(false); return; }

      const armed = readJSON(LOCK_KEY, false);
      const creds = readJSON(CRED_KEY, {});
      const userEmail = session.user?.email || "";
      if (armed && creds[userEmail]) {
        lockedEmail.current = userEmail;
        setEmail(userEmail);
        setScreen("unlock");
        setChecking(false);
        return;
      }
      enter(session);
    })();
    return () => { alive = false; };
  }, [supabase, enter]);

  /* ---------------------------------------------------------- actions */
  async function signIn(e) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    const { data, error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(), password,
    });
    if (err) { setError(friendlyAuthError(err.message)); setBusy(false); return; }

    const session = data.session;
    const creds = readJSON(CRED_KEY, {});
    const userEmail = session.user?.email || email.trim();
    setBusy(false);
    // Offer the sensor once, right after the password has proved who they
    // are — never before, or we'd be arming a lock for an unverified email.
    if (bioReady && !creds[userEmail]) setOfferBio({ session, email: userEmail });
    else enter(session);
  }

  async function signUp(e) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    if (fullName.trim().length < 2) { setError("Enter your full name."); setBusy(false); return; }
    if (password.length < 8) { setError("Use at least 8 characters for your password."); setBusy(false); return; }

    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim(), role: "counsellor" },
        emailRedirectTo: `${window.location.origin}/`,
      },
    });
    if (err) { setError(friendlySignUpError(err.message)); setBusy(false); return; }

    setBusy(false);
    // No session means the project requires an emailed confirmation first.
    if (!data.session) {
      setScreen("signin");
      setPassword("");
      setNotice(`Account created. Check ${email.trim()} for a confirmation link, then sign in.`);
      return;
    }
    const creds = readJSON(CRED_KEY, {});
    const userEmail = data.session.user?.email || email.trim();
    if (bioReady && !creds[userEmail]) setOfferBio({ session: data.session, email: userEmail });
    else enter(data.session);
  }

  async function resetPassword() {
    if (!email.trim()) {
      setError("Enter your email address first, then choose Forgot password.");
      return;
    }
    setBusy(true); setError(null); setNotice(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/`,
    });
    setBusy(false);
    if (err) setError(err.message);
    // Deliberately the same answer either way: whether an address has an
    // account is not something this form should confirm to a stranger.
    else setNotice(`If ${email.trim()} has an account, a reset link is on its way.`);
  }

  async function enableBiometric() {
    setBioBusy(true); setError(null);
    try {
      const credId = await registerBiometric(offerBio.email, offerBio.session.user?.user_metadata?.full_name);
      const creds = readJSON(CRED_KEY, {});
      creds[offerBio.email] = credId;
      writeJSON(CRED_KEY, creds);
      writeJSON(LOCK_KEY, true);
      enter(offerBio.session);
    } catch {
      setError(`${bioLabel} couldn't be set up on this device. You can turn it on later from the sign-in screen.`);
      setBioBusy(false);
    }
  }

  async function unlock() {
    setBioBusy(true); setError(null);
    try {
      const creds = readJSON(CRED_KEY, {});
      const credId = creds[lockedEmail.current];
      const ok = await verifyBiometric(credId);
      if (!ok) throw new Error("no assertion");
      const { data } = await supabase.auth.getSession();
      if (!data?.session) {
        // Sensor said yes, but the stored session lapsed while the app was
        // closed. Nothing to unlock — the password is the way back.
        setScreen("signin");
        setError("Your session has expired. Sign in with your password once more.");
        setBioBusy(false);
        return;
      }
      enter(data.session);
    } catch {
      setError(`${bioLabel} didn't go through. Use your password instead.`);
      setBioBusy(false);
    }
  }

  function usePasswordInstead() {
    setScreen("signin");
    setPassword("");
    setError(null);
    setNotice(null);
  }

  /* ----------------------------------------------------------- render */
  if (checking) {
    return (
      <div style={{ minHeight: "100dvh", background: T.bg, display: "grid", placeItems: "center" }}>
        <div style={{
          width: 28, height: 28, borderRadius: 999, border: `2.5px solid ${T.border}`,
          borderTopColor: T.brand600, animation: "nurora-spin 0.7s linear infinite",
        }} />
        <style>{"@keyframes nurora-spin { to { transform: rotate(360deg); } }"}</style>
      </div>
    );
  }

  if (configProblem) {
    return (
      <Shell>
        <h2 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 600, color: T.text, margin: 0 }}>
          Accounts aren&apos;t set up
        </h2>
        <div style={{ marginTop: 20 }}><Alert tone="error">{configProblem}</Alert></div>
      </Shell>
    );
  }

  if (offerBio) {
    return (
      <Shell>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: 999, background: T.bgSubtle,
            margin: "0 auto 20px", display: "grid", placeItems: "center", fontSize: 26,
          }}>☺</div>
          <h2 style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 600, color: T.text, margin: 0 }}>
            Use {bioLabel} next time?
          </h2>
          <p style={{ fontSize: 14, color: T.muted, marginTop: 10, lineHeight: 1.6 }}>
            Nurora will ask for {bioLabel} before it opens on this device, instead of your password.
            Your password still works, and this only applies to this device.
          </p>
          {error && <div style={{ marginTop: 16 }}><Alert tone="error">{error}</Alert></div>}
          <div style={{ marginTop: 24, display: "grid", gap: 10 }}>
            <PrimaryButton busy={bioBusy} onClick={enableBiometric}>
              Turn on {bioLabel}
            </PrimaryButton>
            <button onClick={() => enter(offerBio.session)} style={{
              height: 44, borderRadius: 999, border: `1px solid ${T.border}`, background: T.card,
              fontSize: 14, color: T.muted, fontFamily: SANS, cursor: "pointer",
            }}>Not now</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (screen === "unlock") {
    return (
      <Shell>
        <h2 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 600, color: T.text, margin: 0 }}>
          Welcome back
        </h2>
        <p style={{ fontSize: 14, color: T.muted, marginTop: 6 }}>
          Signed in as {lockedEmail.current}.
        </p>
        <div style={{ marginTop: 26, display: "grid", gap: 12 }}>
          {error && <Alert tone="error">{error}</Alert>}
          <PrimaryButton busy={bioBusy} onClick={unlock}>
            {`Unlock with ${bioLabel}`}
          </PrimaryButton>
          <button onClick={usePasswordInstead} style={{
            height: 44, borderRadius: 999, border: `1px solid ${T.border}`, background: T.card,
            fontSize: 14, color: T.muted, fontFamily: SANS, cursor: "pointer",
          }}>Use my password instead</button>
        </div>
      </Shell>
    );
  }

  const isSignUp = screen === "signup";

  return (
    <Shell>
      <h2 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 600, color: T.text, margin: 0 }}>
        {isSignUp ? "Create your account" : "Welcome back"}
      </h2>
      <p style={{ fontSize: 14, color: T.muted, marginTop: 6 }}>
        {isSignUp ? "You'll use this email and password to sign in." : "Sign in with your email and password."}
      </p>

      <div style={{ marginTop: 26, display: "grid", gap: 16 }}>
        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        <form onSubmit={isSignUp ? signUp : signIn} style={{ display: "grid", gap: 16 }}>
          {isSignUp && (
            <div>
              <Label htmlFor="fullName">Full name</Label>
              <input id="fullName" type="text" required autoComplete="name" value={fullName}
                onChange={(e) => setFullName(e.target.value)} style={fieldStyle} placeholder="Anisha Rao" />
            </div>
          )}

          <div>
            <Label htmlFor="email">Email address</Label>
            <input id="email" type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} style={fieldStyle} placeholder="you@example.com" />
          </div>

          <div>
            <Label
              htmlFor="password"
              right={
                <div style={{ display: "flex", gap: 14 }}>
                  {!isSignUp && (
                    <button type="button" onClick={resetPassword} style={linkButton}>Forgot password?</button>
                  )}
                  <button type="button" onClick={() => setShowPassword((v) => !v)} style={linkButton}>
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              }
            >Password</Label>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete={isSignUp ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={fieldStyle}
              placeholder={isSignUp ? "At least 8 characters" : "••••••••"}
            />
          </div>

          <PrimaryButton type="submit" busy={busy}>
            {isSignUp ? "Create account" : "Sign in"}
          </PrimaryButton>
        </form>

        {!isSignUp && !bioReady && (
          <p style={{ fontSize: 12, color: T.faint, textAlign: "center", lineHeight: 1.6, margin: 0 }}>
            Face ID, Touch ID and fingerprint sign-in need a device with a sensor,
            over https. They aren&apos;t offered in a preview frame.
          </p>
        )}
        {!isSignUp && bioReady && (
          <p style={{ fontSize: 12, color: T.faint, textAlign: "center", lineHeight: 1.6, margin: 0 }}>
            Sign in once and Nurora will offer to use {bioLabel} on this device from then on.
          </p>
        )}

        <div style={{ fontSize: 13.5, color: T.muted, textAlign: "center" }}>
          {isSignUp ? "Already have an account? " : "Don't have an account? "}
          <button
            type="button"
            onClick={() => {
              setScreen(isSignUp ? "signin" : "signup");
              setError(null); setNotice(null); setPassword("");
            }}
            style={{ ...linkButton, fontSize: 13.5, color: T.brand600, fontWeight: 500 }}
          >{isSignUp ? "Sign in" : "Create one"}</button>
        </div>

        <p style={{ fontSize: 12, color: T.faint, textAlign: "center", lineHeight: 1.6, margin: 0 }}>
          By continuing you agree to Nurora&apos;s terms and privacy policy.
        </p>
      </div>
    </Shell>
  );
}

const linkButton = {
  border: "none", background: "none", padding: 0, cursor: "pointer",
  fontSize: 12.5, color: T.muted, fontFamily: SANS, textDecoration: "underline",
  textUnderlineOffset: 2,
};

/*
 * The two-panel frame. The brand panel is hidden below 1024px, which a
 * media query has to do — an inline style cannot — so it goes in a
 * <style> tag scoped by class name rather than being inlined.
 */
function Shell({ children }) {
  return (
    <div style={{ minHeight: "100dvh", background: T.bg, fontFamily: SANS, color: T.text }}>
      <style>{`
        .nl-grid { display: grid; grid-template-columns: 1fr; min-height: 100dvh; }
        .nl-brand { display: none; }
        .nl-mobile-word { display: block; }
        @media (min-width: 1024px) {
          .nl-grid { grid-template-columns: 1fr 1fr; }
          .nl-brand {
            display: flex; flex-direction: column; justify-content: space-between;
            padding: 48px; border-right: 1px solid ${T.border}; background: ${T.bgSubtle};
            background-image:
              radial-gradient(60% 80% at 15% 0%, ${T.brand300}6b, transparent 70%),
              radial-gradient(50% 70% at 90% 10%, ${T.brand300}45, transparent 70%);
          }
          .nl-mobile-word { display: none; }
        }
        .nl-form-pane { display: flex; align-items: center; justify-content: center; padding: 24px; }
        @media (min-width: 640px) { .nl-form-pane { padding: 48px; } }
        .nl-card { width: 100%; max-width: 384px; animation: nl-in-up .35s cubic-bezier(.22,1,.36,1) both; }
        @keyframes nl-in-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .nl-grid input:focus { border-color: ${T.brand600}; box-shadow: 0 0 0 3px ${T.brand600}1f; }
      `}</style>

      <div className="nl-grid">
        <div className="nl-brand">
          <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Nurora
          </div>

          <div style={{ maxWidth: 448 }}>
            <h1 style={{
              fontFamily: DISPLAY, fontSize: 38, lineHeight: 1.15, fontWeight: 600,
              color: T.text, margin: 0, letterSpacing: "-0.01em",
            }}>
              Care that runs on time.
            </h1>
            <p style={{ marginTop: 20, fontSize: 15, color: T.muted, lineHeight: 1.7 }}>
              Scheduling, session time tracking and payments in one place — with
              reminders that reach both the counsellor and the client three days
              before every appointment.
            </p>
            <ul style={{ marginTop: 32, padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
              {SELLING_POINTS.map((line) => (
                <li key={line} style={{ display: "flex", alignItems: "flex-start", gap: 12, fontSize: 14 }}>
                  <Tick />
                  <span style={{ color: T.muted }}>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <p style={{ fontSize: 12, color: T.faint, margin: 0 }}>
            Your session notes stay private to you and your client.
          </p>
        </div>

        <div className="nl-form-pane">
          <div className="nl-card">
            <div className="nl-mobile-word" style={{
              fontFamily: DISPLAY, fontSize: 20, fontWeight: 600, marginBottom: 32, letterSpacing: "-0.01em",
            }}>Nurora</div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ copy */
// Supabase's own wording is written for developers. These are the cases
// people actually hit.
function friendlyAuthError(message) {
  const m = (message || "").toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "That email and password don't match an account. Check both, or use Forgot password.";
  }
  if (m.includes("email not confirmed")) {
    return "This account hasn't been confirmed yet. Open the link in the sign-up email, then try again.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many attempts just now. Wait a minute and try again.";
  }
  if (m.includes("failed to fetch") || m.includes("network")) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return message || "Sign-in failed. Try again.";
}

function friendlySignUpError(message) {
  const m = (message || "").toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "That email already has an account. Sign in instead, or use Forgot password.";
  }
  if (m.includes("password")) {
    return "That password was rejected — use at least 8 characters.";
  }
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) {
    return "New accounts are turned off for this clinic. Ask your admin to create one for you.";
  }
  return message || "Couldn't create the account. Try again.";
}

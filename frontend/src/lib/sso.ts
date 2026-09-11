// SSO helpers — Google (Emergent-managed) + Apple.
//
// The two providers use very different OS-level machinery so we hide
// that behind two functions with the same shape:
//
//   signInWithGoogle() → Promise<AuthEnvelope | null>
//   signInWithApple()  → Promise<AuthEnvelope | null>
//
// Both return the same {token, user} shape the rest of the app already
// consumes via AuthProvider.adoptSession(). `null` means the user
// cancelled — callers should NOT toast anything in that case.
//
// Notes:
//   • Google works on iOS, Android, and web (Expo Go included). It
//     opens a system browser via expo-web-browser and reads the
//     session_id from the callback URL, then trades it with the
//     backend at POST /api/auth/session.
//   • Apple is iOS-only. Use `isAppleSignInAvailable()` before
//     rendering the button; the button is a native
//     AppleAuthenticationButton for App Store compliance.
//   • Deep-link cold-start: root `_layout.tsx` calls
//     `consumeGoogleColdStart()` on mount to pick up a `session_id`
//     that arrived while the app was killed.

import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { AuthEnvelope, User } from "@/src/lib/api";

// Populated by src/lib/api.ts via `process.env.EXPO_PUBLIC_BACKEND_URL`.
// We re-read it here rather than importing BACKEND_URL to avoid a
// circular import through api.ts's giant module.
const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL as string;

// Emergent hosts the Google consent page. Do NOT hit their /auth/v1
// endpoint from the client — the backend is the only caller.
const EMERGENT_AUTH_URL = "https://auth.emergentagent.com/";

// Some deep links contain the session_id in the fragment, others in the
// query — this single regex pulls it out either way.
const SESSION_ID_RE = /[?#&]session_id=([^&#]+)/;

// De-dupe guard: `WebBrowser.openAuthSessionAsync` sometimes returns
// the same session_id twice on Android (once via `result.url`, once via
// the `Linking` listener). We reject the second call to avoid a 401
// from Emergent's single-use endpoint.
const _consumed = new Set<string>();

// Complete any pending auth session at import time (required by
// expo-web-browser on the web).
WebBrowser.maybeCompleteAuthSession();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function buildRedirectUrl(): string {
  // On web the callback must be a real route in our router — the login
  // screen works fine because `_layout.tsx` inspects the URL on every
  // mount and consumes the session_id before rendering the login form.
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin + "/login";
  }
  // On mobile, Linking.createURL builds the right prefix for both Expo
  // Go (exp://…) and standalone builds (oromona://…).
  return Linking.createURL("login");
}

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(SESSION_ID_RE);
  return m ? decodeURIComponent(m[1]) : null;
}

async function exchangeGoogleSessionId(
  sessionId: string,
): Promise<AuthEnvelope | null> {
  if (_consumed.has(sessionId)) return null;
  _consumed.add(sessionId);
  const res = await fetch(`${BASE_URL}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = "Google sign-in failed";
    try {
      const parsed = JSON.parse(text);
      msg = parsed.detail || msg;
    } catch {}
    throw new Error(msg);
  }
  return JSON.parse(text) as AuthEnvelope;
}

// ---------------------------------------------------------------------------
// Google (Emergent-managed) — supports iOS, Android, Expo Go, and web.
// ---------------------------------------------------------------------------
export async function signInWithGoogle(): Promise<AuthEnvelope | null> {
  const redirectUrl = buildRedirectUrl();
  const authUrl = `${EMERGENT_AUTH_URL}?redirect=${encodeURIComponent(redirectUrl)}`;

  // Web: openAuthSessionAsync opens a popup we can't read back reliably.
  // Do a full-page navigate — `_layout.tsx` picks the session_id up on
  // return.
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.location.href = authUrl;
    return null;
  }

  // Native: register a listener BEFORE opening the session so we still
  // catch the deep link on Android (Custom Tabs can return
  // `type: dismiss` even on success).
  let listenerHit: string | null = null;
  const sub = Linking.addEventListener("url", (evt) => {
    const sid = extractSessionId(evt?.url);
    if (sid) listenerHit = sid;
  });

  try {
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    // Cancelled by the user tapping "Cancel" in the browser sheet.
    if (result.type === "cancel") return null;

    // Read from every possible source in priority order. Do NOT treat
    // `dismiss` as a cancellation — it's the Android success path with a
    // missing URL.
    let sessionId =
      (result.type === "success" && extractSessionId(result.url)) ||
      listenerHit ||
      extractSessionId(await Linking.getInitialURL());

    if (!sessionId) return null; // Genuine cancellation.
    return await exchangeGoogleSessionId(sessionId);
  } finally {
    sub.remove();
  }
}

// ---------------------------------------------------------------------------
// Cold-start deep link handler (mobile only). Called from `_layout.tsx`.
// Returns the freshly-minted session, or null if there's nothing to do.
// ---------------------------------------------------------------------------
export async function consumeGoogleColdStart(): Promise<AuthEnvelope | null> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return null;
    // Web: parse hash + query, then clean the URL.
    const url = window.location.href;
    const sessionId = extractSessionId(url);
    if (!sessionId) return null;
    try {
      const envelope = await exchangeGoogleSessionId(sessionId);
      // Remove only session_id from the URL — preserve any other params.
      try {
        const u = new URL(url);
        u.hash = u.hash.replace(/[#&]?session_id=[^&#]+/g, "").replace(/^#$/, "");
        u.searchParams.delete("session_id");
        window.history.replaceState(window.history.state, "", u.toString());
      } catch {}
      return envelope;
    } catch (e) {
      // Bad/expired session — clean the URL anyway so refresh loops don't stick.
      try {
        window.history.replaceState(window.history.state, "", window.location.pathname);
      } catch {}
      throw e;
    }
  }

  const initial = await Linking.getInitialURL();
  const sessionId = extractSessionId(initial);
  if (!sessionId) return null;
  return exchangeGoogleSessionId(sessionId);
}

// ---------------------------------------------------------------------------
// Apple (iOS only)
// ---------------------------------------------------------------------------
type AppleModule = typeof import("expo-apple-authentication");

let _appleMod: AppleModule | null | undefined = undefined;

async function loadAppleModule(): Promise<AppleModule | null> {
  if (_appleMod !== undefined) return _appleMod;
  if (Platform.OS !== "ios") {
    _appleMod = null;
    return null;
  }
  try {
    _appleMod = (await import("expo-apple-authentication")) as AppleModule;
  } catch {
    _appleMod = null;
  }
  return _appleMod;
}

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  // Expo Go: expo-apple-authentication is bundled with the Expo Go app,
  // so `isAvailableAsync()` is authoritative — no dev-build gate needed.
  const mod = await loadAppleModule();
  if (!mod) return false;
  try {
    return await mod.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function signInWithApple(): Promise<AuthEnvelope | null> {
  const mod = await loadAppleModule();
  if (!mod) throw new Error("Apple sign-in is only available on iOS");

  let credential: import("expo-apple-authentication").AppleAuthenticationCredential;
  try {
    credential = await mod.signInAsync({
      requestedScopes: [
        mod.AppleAuthenticationScope.FULL_NAME,
        mod.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e: any) {
    // Standard cancel code — the button/toast layer must NOT surface this.
    if (e?.code === "ERR_REQUEST_CANCELED" || e?.code === "ERR_CANCELED") {
      return null;
    }
    throw e;
  }

  if (!credential.identityToken) {
    throw new Error("Apple did not return an identity token");
  }

  const fullName = credential.fullName
    ? [credential.fullName.givenName, credential.fullName.familyName]
        .filter(Boolean)
        .join(" ")
        .trim() || null
    : null;

  const res = await fetch(`${BASE_URL}/api/auth/apple`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity_token: credential.identityToken,
      // These are only present on first login — Apple returns null on
      // repeat sign-ins so the backend keeps whatever was persisted the
      // first time.
      email: credential.email ?? null,
      full_name: fullName,
      // Apple returns a one-time authorization_code alongside the
      // identity token. The backend trades it for a long-lived refresh
      // token so account deletion can call /auth/revoke — required by
      // App Store guideline 5.1.1(v).
      authorization_code: credential.authorizationCode ?? null,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = "Apple sign-in failed";
    try {
      const parsed = JSON.parse(text);
      msg = parsed.detail || msg;
    } catch {}
    throw new Error(msg);
  }
  return JSON.parse(text) as AuthEnvelope;
}

// Re-export for callers that don't want to `import type` a full envelope.
export type SsoResult = { token: string; user: User } | null;

// Keep a hint of where we run — some UI wants to explain why Apple isn't
// shown on Android/web.
export const appleSupportedPlatform = Platform.OS === "ios";
export const runningInExpoGo = Constants.appOwnership === "expo";

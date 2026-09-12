// Boot diagnostics — answers "why is the screen blank on a tester's
// phone?" when we cannot see the device.
//
// Every stage (module eval → fonts → first route → welcome layout) is
// logged locally AND posted to `POST /api/diag` in small batches so the
// backend log shows the device's real boot timeline. Errors from the
// global handler / console.error / ErrorBoundary are captured too.
//
// Cheap, fire-and-forget, never throws.

import Constants from "expo-constants";
import { Dimensions, PixelRatio, Platform } from "react-native";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL as string;

const session = Math.random().toString(36).slice(2, 10);
const startedAt = Date.now();

type Event = { stage: string; data: Record<string, unknown> | null; t: number };

let queue: Event[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

function deviceInfo() {
  return {
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    dev: __DEV__,
    execEnv: Constants.executionEnvironment,
    appOwnership: Constants.appOwnership,
    expoGoVersion: Constants.expoVersion,
    nativeAppVersion: Constants.nativeAppVersion,
    hostUri: Constants.expoConfig?.hostUri ?? null,
    window: Dimensions.get("window"),
    scale: PixelRatio.get(),
    fontScale: PixelRatio.getFontScale(),
  };
}

function flush() {
  timer = null;
  if (!queue.length || !BASE_URL) return;
  const events = queue;
  queue = [];
  fetch(`${BASE_URL}/api/diag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, device: deviceInfo(), events }),
  }).catch(() => {});
}

export function diag(stage: string, data?: Record<string, unknown>) {
  const evt: Event = { stage, data: data ?? null, t: Date.now() - startedAt };
  console.log(`[boot +${evt.t}ms] ${stage}`, data ?? "");
  queue.push(evt);
  if (!timer) timer = setTimeout(flush, 500);
}

const str = (v: unknown) => {
  try {
    return typeof v === "string" ? v : JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

/** Hook global error + console.error/warn so device-side failures reach
 *  the backend log. Idempotent. */
export function installBootDiag() {
  if (installed) return;
  installed = true;

  const g = globalThis as any;
  const eu = g.ErrorUtils;
  if (eu?.setGlobalHandler) {
    const prev = eu.getGlobalHandler?.();
    eu.setGlobalHandler((e: any, isFatal?: boolean) => {
      diag("global-error", {
        fatal: !!isFatal,
        message: str(e?.message ?? e).slice(0, 800),
        stack: str(e?.stack ?? "").slice(0, 1500),
      });
      flush();
      prev?.(e, isFatal);
    });
  }

  const origError = console.error;
  console.error = (...args: unknown[]) => {
    diag("console.error", { msg: args.map(str).join(" ").slice(0, 1200) });
    origError(...args);
  };
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    diag("console.warn", { msg: args.map(str).join(" ").slice(0, 600) });
    origWarn(...args);
  };

  diag("diag-installed");
}

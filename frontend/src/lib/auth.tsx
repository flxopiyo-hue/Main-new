// Oromona auth context: holds current user + token, persists token via secureStore.
//
// New in iteration 12 (role switcher): `login` now accepts an optional
// `asRole` argument so the user can pick their entry point on the login
// screen. `toggleRole` flips the user between buyer ↔ seller, persists the
// freshly-minted JWT, and returns the updated User so navigation guards
// can re-route accordingly.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  api,
  AuthEnvelope,
  BankDetails,
  Gender,
  Location,
  setToken as setTokenStorage,
  User,
} from "@/src/lib/api";
import { signInWithApple, signInWithGoogle, consumeGoogleColdStart } from "@/src/lib/sso";
import { storage } from "@/src/utils/storage";

const TOKEN_KEY = "aurafit.token";

// Oromona is a Kenyan marketplace — KSh (KES) is the standard currency for
// every account. Users can still change it manually in Profile → Region &
// Currency, but we never auto-switch based on device locale.
const STANDARD_CURRENCY = "KES" as const;

export type RegisterBuyerOpts = {
  gender: Gender;
  dob?: string;
  age?: number;
};

export type RegisterSellerOpts = {
  company_name: string;
  location: Location;
  bank_details?: BankDetails;
};

export type LoginResult = {
  user: User;
  needsSellerOnboarding: boolean;
};

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (
    email: string,
    password: string,
    asRole?: "buyer" | "seller",
  ) => Promise<LoginResult>;
  registerBuyer: (
    email: string,
    password: string,
    fullName: string,
    opts: RegisterBuyerOpts,
  ) => Promise<User>;
  registerSeller: (
    email: string,
    password: string,
    fullName: string,
    opts: RegisterSellerOpts,
  ) => Promise<User>;
  // Boda rider signup — account starts pending until admin approval.
  registerCourier: (
    email: string,
    password: string,
    fullName: string,
    opts: { phone: string; mpesa_number?: string },
  ) => Promise<User>;
  // Flip between buyer ↔ seller. When switching TO seller the caller may
  // need to pass the seller onboarding fields; the backend rejects the
  // toggle if essentials are still missing.
  toggleRole: (
    opts?: {
      to?: "buyer" | "seller";
      company_name?: string;
      location?: Location;
      bank_details?: BankDetails;
    },
  ) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  // Adopt a fresh auth envelope (used by password-reset and any other
  // flow that mints a JWT server-side and needs to sign the user in
  // immediately on the client).
  adoptSession: (envelope: { token: string; user: User }) => Promise<void>;
  // SSO — returns null when the user cancels the provider sheet.
  // Callers should NOT show a toast on `null`. Any thrown error is a
  // real failure worth surfacing.
  loginWithGoogle: () => Promise<User | null>;
  loginWithApple: () => Promise<User | null>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setUser(null);
      await setTokenStorage(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      // Cold-start Google Auth (Emergent): the browser dropped us back
      // with `session_id=...` in the URL. Consume it BEFORE checking the
      // stored token so an existing/expired session doesn't blow past the
      // fresh sign-in the user just completed.
      try {
        const envelope = await consumeGoogleColdStart();
        if (envelope) {
          await setTokenStorage(envelope.token);
          setUser(envelope.user);
          setLoading(false);
          return;
        }
      } catch {
        // Fall through — user still has other ways to sign in.
      }
      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      if (token) {
        await refresh();
      }
      setLoading(false);
    })();
  }, [refresh]);

  const login = useCallback(
    async (
      email: string,
      password: string,
      asRole?: "buyer" | "seller",
    ): Promise<LoginResult> => {
      const envelope: AuthEnvelope = await api.login({
        email,
        password,
        as_role: asRole,
      });
      await setTokenStorage(envelope.token);
      setUser(envelope.user);
      return { user: envelope.user, needsSellerOnboarding: !!envelope.needs_seller_onboarding };
    },
    [],
  );

  const registerBuyer = useCallback(
    async (
      email: string,
      password: string,
      fullName: string,
      opts: RegisterBuyerOpts,
    ) => {
      const { token, user: u } = await api.register({
        email,
        password,
        full_name: fullName,
        role: "buyer",
        gender: opts.gender,
        age: opts.age,
        dob: opts.dob,
        preferred_currency: STANDARD_CURRENCY,
      });
      await setTokenStorage(token);
      setUser(u);
      return u;
    },
    [],
  );

  const registerSeller = useCallback(
    async (
      email: string,
      password: string,
      fullName: string,
      opts: RegisterSellerOpts,
    ) => {
      const { token, user: u } = await api.register({
        email,
        password,
        full_name: fullName,
        role: "seller",
        preferred_currency: STANDARD_CURRENCY,
        company_name: opts.company_name,
        location: opts.location,
        bank_details: opts.bank_details,
      });
      await setTokenStorage(token);
      setUser(u);
      return u;
    },
    [],
  );

  const registerCourier = useCallback(
    async (
      email: string,
      password: string,
      fullName: string,
      opts: { phone: string; mpesa_number?: string },
    ) => {
      const { token, user: u } = await api.register({
        email,
        password,
        full_name: fullName,
        role: "courier",
        phone: opts.phone,
        mpesa_number: opts.mpesa_number,
      });
      await setTokenStorage(token);
      setUser(u);
      return u;
    },
    [],
  );

  const toggleRole = useCallback(
    async (opts: {
      to?: "buyer" | "seller";
      company_name?: string;
      location?: Location;
      bank_details?: BankDetails;
    } = {}) => {
      const envelope = await api.toggleRole(opts);
      await setTokenStorage(envelope.token);
      setUser(envelope.user);
      return envelope.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    await setTokenStorage(null);
    setUser(null);
  }, []);

  const adoptSession = useCallback(
    async (envelope: { token: string; user: User }) => {
      await setTokenStorage(envelope.token);
      setUser(envelope.user);
    },
    [],
  );

  const loginWithGoogle = useCallback(async (): Promise<User | null> => {
    const envelope = await signInWithGoogle();
    if (!envelope) return null;
    await setTokenStorage(envelope.token);
    setUser(envelope.user);
    return envelope.user;
  }, []);

  const loginWithApple = useCallback(async (): Promise<User | null> => {
    const envelope = await signInWithApple();
    if (!envelope) return null;
    await setTokenStorage(envelope.token);
    setUser(envelope.user);
    return envelope.user;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      registerBuyer,
      registerSeller,
      registerCourier,
      toggleRole,
      logout,
      refresh,
      adoptSession,
      loginWithGoogle,
      loginWithApple,
    }),
    [user, loading, login, registerBuyer, registerSeller, registerCourier, toggleRole, logout, refresh, adoptSession, loginWithGoogle, loginWithApple],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

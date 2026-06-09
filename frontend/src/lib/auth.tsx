// Drape auth context: holds current user + token, persists token via secureStore.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, BankDetails, Gender, Location, setToken as setTokenStorage, User } from "@/src/lib/api";
import { getDeviceRegion, suggestCurrencyForRegion } from "@/src/lib/locale";
import { storage } from "@/src/utils/storage";

const TOKEN_KEY = "aurafit.token";
const LOCALE_SYNC_KEY = "drape.localeCurrencySynced";

/**
 * Silently align the user's preferred_currency with their device region the
 * first time we see them on this device. Runs at most once per device (via
 * AsyncStorage flag) so manually-chosen currencies are never overwritten.
 */
async function syncCurrencyToLocale(user: User): Promise<User> {
  try {
    const alreadySynced = await storage.getItem<string>(LOCALE_SYNC_KEY, "");
    if (alreadySynced) return user;
    const region = getDeviceRegion();
    const suggested = suggestCurrencyForRegion(region);
    if (!suggested) {
      await storage.setItem(LOCALE_SYNC_KEY, "skipped");
      return user;
    }
    if (user.preferred_currency === suggested) {
      await storage.setItem(LOCALE_SYNC_KEY, "matched");
      return user;
    }
    const updated = await api.updatePreferences({ preferred_currency: suggested });
    await storage.setItem(LOCALE_SYNC_KEY, suggested);
    return updated;
  } catch {
    // If the patch fails (network etc.) we just return the original user —
    // the next login will retry until the flag is set.
    return user;
  }
}

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

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
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
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
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
      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      if (token) {
        await refresh();
      }
      setLoading(false);
    })();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: u } = await api.login({ email, password });
    await setTokenStorage(token);
    const synced = await syncCurrencyToLocale(u);
    setUser(synced);
    return synced;
  }, []);

  const registerBuyer = useCallback(
    async (
      email: string,
      password: string,
      fullName: string,
      opts: RegisterBuyerOpts,
    ) => {
      const region = getDeviceRegion();
      const preferred_currency = suggestCurrencyForRegion(region) ?? undefined;
      const { token, user: u } = await api.register({
        email,
        password,
        full_name: fullName,
        role: "buyer",
        gender: opts.gender,
        age: opts.age,
        dob: opts.dob,
        preferred_currency,
      });
      await setTokenStorage(token);
      await storage.setItem(LOCALE_SYNC_KEY, preferred_currency ?? "skipped");
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
      const region = getDeviceRegion();
      const preferred_currency = suggestCurrencyForRegion(region) ?? undefined;
      const { token, user: u } = await api.register({
        email,
        password,
        full_name: fullName,
        role: "seller",
        preferred_currency,
        company_name: opts.company_name,
        location: opts.location,
        bank_details: opts.bank_details,
      });
      await setTokenStorage(token);
      await storage.setItem(LOCALE_SYNC_KEY, preferred_currency ?? "skipped");
      setUser(u);
      return u;
    },
    [],
  );

  const logout = useCallback(async () => {
    await setTokenStorage(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, registerBuyer, registerSeller, logout, refresh }),
    [user, loading, login, registerBuyer, registerSeller, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

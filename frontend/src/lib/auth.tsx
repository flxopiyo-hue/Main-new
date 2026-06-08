// AuraFit auth context: holds current user + token, persists token via secureStore.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, Role, setToken as setTokenStorage, User } from "@/src/lib/api";
import { storage } from "@/src/utils/storage";

const TOKEN_KEY = "aurafit.token";

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, fullName: string, role: Role) => Promise<User>;
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
    setUser(u);
    return u;
  }, []);

  const register = useCallback(
    async (email: string, password: string, fullName: string, role: Role) => {
      const { token, user: u } = await api.register({
        email,
        password,
        full_name: fullName,
        role,
      });
      await setTokenStorage(token);
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
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

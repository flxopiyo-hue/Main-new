// Active profile context — tracks which body profile (self / loved-one) drives
// Discover audience filtering and Try-On photo selection.

import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { ActiveProfile, api, ProfileSummary } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";

interface ProfileContextValue {
  profiles: ProfileSummary[];
  active: ActiveProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setActive: (profileId: string) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [active, setActive] = useState<ActiveProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user || user.role !== "buyer") {
      setProfiles([]);
      setActive(null);
      return;
    }
    setLoading(true);
    try {
      const [all, act] = await Promise.all([api.listProfiles(), api.getActiveProfile()]);
      setProfiles(all);
      setActive(act);
    } catch (err) {
      // Silent failure — chip will just show "Me" placeholder.
      // eslint-disable-next-line no-console
      console.warn("Profile load failed", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setActiveProfile = useCallback(async (profileId: string) => {
    const next = await api.setActiveProfile(profileId);
    setActive(next);
  }, []);

  const value = useMemo<ProfileContextValue>(
    () => ({ profiles, active, loading, refresh, setActive: setActiveProfile }),
    [profiles, active, loading, refresh, setActiveProfile],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfiles() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfiles must be used within ProfileProvider");
  return ctx;
}

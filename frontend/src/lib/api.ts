// AuraFit API client. Talks to FastAPI backend at EXPO_PUBLIC_BACKEND_URL.
// All authenticated requests include the bearer token from secure storage.

import { storage } from "@/src/utils/storage";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL as string;
const TOKEN_KEY = "aurafit.token";

export type Role = "buyer" | "seller";
export type Gender = "male" | "female" | "other" | "prefer_not_to_say";
export type Audience = "men" | "women" | "unisex";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  gender?: Gender | null;
  age?: number | null;
  dob?: string | null;
  created_at: string;
}

export interface Measurements {
  height_cm?: number | null;
  chest_cm?: number | null;
  waist_cm?: number | null;
  hips_cm?: number | null;
  shoulders_cm?: number | null;
  inseam_cm?: number | null;
}

export interface Profile {
  user_id: string;
  measurements: Measurements;
  preferred_size?: string | null;
  has_front_photo: boolean;
  has_side_photo: boolean;
  updated_at: string;
}

export interface SizeOption {
  label: string;
  chest_cm?: number | null;
  waist_cm?: number | null;
  hips_cm?: number | null;
  length_cm?: number | null;
  available_qty: number;
}

export interface ColorOption {
  name: string;
  hex: string;
}

export interface Item {
  id: string;
  seller_id: string;
  seller_name: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  image_b64: string;
  sizes: SizeOption[];
  colors: ColorOption[];
  audience: Audience;
  created_at: string;
}

export interface TryOnResult {
  id: string;
  item_id: string;
  result_image_b64: string;
  fit_summary?: string | null;
  created_at: string;
}

export interface Order {
  id: string;
  buyer_id: string;
  item_id: string;
  item_name: string;
  size: string;
  color?: string | null;
  amount_cents: number;
  status: string;
  session_id: string;
  created_at: string;
}

async function getToken(): Promise<string | null> {
  return storage.secureGet<string>(TOKEN_KEY, "");
}

export async function setToken(token: string | null): Promise<void> {
  if (token) {
    await storage.secureSet(TOKEN_KEY, token);
  } else {
    await storage.secureRemove(TOKEN_KEY);
  }
}

interface RequestOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.auth !== false) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const json = JSON.parse(text);
      detail = json.detail || text;
    } catch {}
    throw new Error(typeof detail === "string" ? detail : "Request failed");
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  // Auth
  register: (body: {
    email: string;
    password: string;
    full_name: string;
    role: Role;
    gender: Gender;
    age?: number;
    dob?: string;
  }) => request<{ token: string; user: User }>("/auth/register", { method: "POST", body, auth: false }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: User }>("/auth/login", { method: "POST", body, auth: false }),
  me: () => request<User>("/auth/me"),

  // Profile
  getProfile: () => request<Profile>("/profile"),
  updateProfile: (body: {
    measurements: Measurements;
    preferred_size?: string | null;
    front_photo_b64?: string;
    side_photo_b64?: string;
  }) => request<Profile>("/profile", { method: "PUT", body }),
  estimateMeasurements: (body: {
    front_photo_b64: string;
    side_photo_b64: string;
    height_cm?: number;
  }) => request<Measurements>("/profile/estimate", { method: "POST", body }),

  // Items
  listItems: (params: {
    category?: string;
    size?: string;
    color?: string;
    audience?: string;
    q?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.append(k, String(v));
    });
    const suffix = qs.toString();
    return request<Item[]>(`/items${suffix ? `?${suffix}` : ""}`);
  },
  myItems: () => request<Item[]>("/items/mine"),
  getItem: (id: string) => request<Item>(`/items/${id}`),
  createItem: (body: {
    name: string;
    description: string;
    category: string;
    price_cents: number;
    image_b64: string;
    sizes: SizeOption[];
    colors: ColorOption[];
    audience: Audience;
  }) => request<Item>("/items", { method: "POST", body }),
  deleteItem: (id: string) => request<{ ok: boolean }>(`/items/${id}`, { method: "DELETE" }),

  // Try-On
  tryOn: (body: { item_id: string; use_profile_photo?: boolean; body_photo_b64?: string }) =>
    request<TryOnResult>("/tryon", { method: "POST", body }),
  tryOnHistory: () => request<TryOnResult[]>("/tryon/history"),

  // Payments
  checkout: (body: { item_id: string; size: string; color?: string; origin_url: string }) =>
    request<{ session_id: string; url: string }>("/payments/checkout", { method: "POST", body }),
  paymentStatus: (sessionId: string) =>
    request<{ session_id: string; status: string; item_name: string; amount_cents: number }>(
      `/payments/status/${sessionId}`,
    ),
  orders: () => request<Order[]>("/orders"),
};

export const BACKEND_URL = BASE_URL;

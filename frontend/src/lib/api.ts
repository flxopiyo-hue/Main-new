// AuraFit API client. Talks to FastAPI backend at EXPO_PUBLIC_BACKEND_URL.
// All authenticated requests include the bearer token from secure storage.

import { storage } from "@/src/utils/storage";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL as string;
const TOKEN_KEY = "aurafit.token";

export type Role = "buyer" | "seller";
export type Gender = "male" | "female" | "other" | "prefer_not_to_say";
export type Audience = "men" | "women" | "unisex";
export type CurrencyCode =
  | "USD"
  | "KES"
  | "EUR"
  | "GBP"
  | "NGN"
  | "ZAR"
  | "INR"
  | "UGX"
  | "TZS"
  | "RWF"
  | "GHS"
  | "EGP";
export type TryOnAngle = "front" | "three_quarter" | "side" | "back";
export type GarmentType =
  | "vest_under"
  | "shirt"
  | "dress"
  | "skirt"
  | "trousers"
  | "shorts"
  | "belt"
  | "tie"
  | "scarf"
  | "waistcoat"
  | "outerwear"
  | "socks"
  | "shoes"
  | "hat"
  | "bag"
  | "jewelry"
  | "other";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  gender?: Gender | null;
  age?: number | null;
  dob?: string | null;
  stripe_account_id?: string | null;
  connect_status?: "unstarted" | "pending" | "active";
  preferred_currency?: CurrencyCode;
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
  has_three_quarter_photo?: boolean;
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
  currency: CurrencyCode;
  garment_type: GarmentType;
  image_b64: string;
  sizes: SizeOption[];
  colors: ColorOption[];
  audience: Audience;
  created_at: string;
}

export interface TryOnImageOut {
  angle: TryOnAngle;
  image_b64: string;
}

export interface TryOnResult {
  id: string;
  item_id: string;
  result_image_b64: string;
  images?: TryOnImageOut[];
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
  currency: CurrencyCode;
  status: string;
  fit_feedback?: "small" | "perfect" | "large" | null;
  session_id: string;
  created_at: string;
}

export type FitFeedback = "small" | "perfect" | "large";

export interface WishlistEntry {
  item: Item;
  added_at: string;
  restocked: boolean;
}

export interface ItemAnalytics {
  item_id: string;
  name: string;
  views: number;
  try_ons: number;
  wishlists: number;
  orders_paid: number;
  revenue_cents: number;
  platform_fee_cents: number;
  net_cents: number;
  conversion: number;
}

export interface SellerAnalytics {
  total_views: number;
  total_try_ons: number;
  total_wishlists: number;
  total_orders_paid: number;
  total_revenue_cents: number;
  total_platform_fee_cents: number;
  total_net_cents: number;
  connect_status: "unstarted" | "pending" | "active";
  platform_fee_bps: number;
  items: ItemAnalytics[];
}

export interface ConnectStatus {
  stripe_account_id?: string | null;
  connect_status: "unstarted" | "pending" | "active";
  onboarding_url?: string | null;
  platform_fee_bps: number;
  note?: string | null;
}

export interface Collection {
  id: string;
  seller_id: string;
  seller_name: string;
  name: string;
  description: string;
  item_ids: string[];
  cover_image_b64?: string | null;
  created_at: string;
}

export interface TryOnShare {
  image_b64: string;
  caption: string;
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
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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
    preferred_currency?: CurrencyCode;
  }) => request<{ token: string; user: User }>("/auth/register", { method: "POST", body, auth: false }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: User }>("/auth/login", { method: "POST", body, auth: false }),
  me: () => request<User>("/auth/me"),
  updatePreferences: (body: { preferred_currency?: CurrencyCode }) =>
    request<User>("/auth/preferences", { method: "PATCH", body }),

  // Profile
  getProfile: () => request<Profile>("/profile"),
  updateProfile: (body: {
    measurements: Measurements;
    preferred_size?: string | null;
    front_photo_b64?: string;
    side_photo_b64?: string;
    three_quarter_photo_b64?: string;
  }) => request<Profile>("/profile", { method: "PUT", body }),
  estimateMeasurements: (body: {
    front_photo_b64?: string;
    side_photo_b64?: string;
    three_quarter_photo_b64?: string;
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
    currency?: CurrencyCode;
    image_b64: string;
    sizes: SizeOption[];
    colors: ColorOption[];
    audience: Audience;
  }) => request<Item>("/items", { method: "POST", body }),
  deleteItem: (id: string) => request<{ ok: boolean }>(`/items/${id}`, { method: "DELETE" }),

  // Try-On
  tryOn: (body: {
    item_id: string;
    use_profile_photo?: boolean;
    body_photo_b64?: string;
    angles?: TryOnAngle[];
  }) => request<TryOnResult>("/tryon", { method: "POST", body }),
  tryOnOutfit: (body: {
    item_ids: string[];
    use_profile_photo?: boolean;
    body_photo_b64?: string;
    angles?: TryOnAngle[];
  }) => request<TryOnResult>("/tryon/outfit", { method: "POST", body }),
  tryOnHistory: () => request<TryOnResult[]>("/tryon/history"),
  shareTryOn: (
    id: string,
    fmt: "square" | "story" = "square",
    angle: TryOnAngle = "front",
  ) =>
    request<TryOnShare>(`/tryon/${id}/share?fmt=${fmt}&angle=${angle}`),

  // Wishlist
  addWishlist: (itemId: string) =>
    request<{ ok: boolean }>(`/wishlist/${itemId}`, { method: "POST" }),
  removeWishlist: (itemId: string) =>
    request<{ ok: boolean }>(`/wishlist/${itemId}`, { method: "DELETE" }),
  listWishlist: () => request<WishlistEntry[]>("/wishlist"),
  wishlistIds: () => request<{ item_ids: string[] }>("/wishlist/ids"),

  // Seller analytics + inventory + connect
  sellerAnalytics: () => request<SellerAnalytics>("/seller/analytics"),
  connectStatus: () => request<ConnectStatus>("/seller/connect/status"),
  connectSetup: () => request<ConnectStatus>("/seller/connect/setup", { method: "POST" }),
  patchItem: (id: string, body: { sizes?: SizeOption[] }) =>
    request<Item>(`/items/${id}`, { method: "PATCH", body }),

  // Feed (algorithmic discover)
  feed: () => request<Item[]>("/feed"),

  // Collections
  listCollections: () => request<Collection[]>("/collections"),
  myCollections: () => request<Collection[]>("/collections/mine"),
  getCollection: (id: string) =>
    request<{ collection: Collection; items: Item[] }>(`/collections/${id}`),
  createCollection: (body: { name: string; description: string; item_ids: string[] }) =>
    request<Collection>("/collections", { method: "POST", body }),
  deleteCollection: (id: string) =>
    request<{ ok: boolean }>(`/collections/${id}`, { method: "DELETE" }),

  // Order fit feedback
  orderFeedback: (id: string, fit: FitFeedback) =>
    request<Order>(`/orders/${id}/feedback`, { method: "POST", body: { fit } }),

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

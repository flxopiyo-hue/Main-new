// AuraFit API client. Talks to FastAPI backend at EXPO_PUBLIC_BACKEND_URL.
// All authenticated requests include the bearer token from secure storage.

import { storage } from "@/src/utils/storage";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL as string;
const TOKEN_KEY = "aurafit.token";

export type Role = "buyer" | "seller" | "admin";
export type Gender = "male" | "female" | "other" | "prefer_not_to_say";
export type ConnectStatusCode = "unstarted" | "pending" | "active";
export type Audience = "men" | "women" | "unisex" | "kids";
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

export interface Location {
  city: string;
  country: string;
}

export interface BankDetails {
  bank_name?: string | null;
  branch?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  swift_code?: string | null;
  mpesa_paybill?: string | null;
  mpesa_till?: string | null;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  gender?: Gender | null;
  age?: number | null;
  dob?: string | null;
  stripe_account_id?: string | null;
  connect_status?: ConnectStatusCode;
  preferred_currency?: CurrencyCode;
  // Seller-specific (null for buyers/admins)
  company_name?: string | null;
  location?: Location | null;
  bank_details?: BankDetails | null;
  suspended?: boolean;
  token_version?: number;
  created_at: string;
}

export interface AuthEnvelope {
  token: string;
  user: User;
  needs_seller_onboarding?: boolean;
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
  // Tops / jackets / outerwear / sweaters
  chest_cm?: number | null;
  shoulder_cm?: number | null;
  sleeve_cm?: number | null;
  length_cm?: number | null;
  // Bottoms (trousers / shorts / skirts)
  waist_cm?: number | null;
  hips_cm?: number | null;
  inseam_cm?: number | null;
  rise_cm?: number | null;
  // Dresses
  bust_cm?: number | null;
  available_qty: number;
}

export type DimensionKey =
  | "chest_cm" | "shoulder_cm" | "sleeve_cm" | "length_cm"
  | "waist_cm" | "hips_cm" | "inseam_cm" | "rise_cm"
  | "bust_cm";

export interface SizeGuide {
  garment_type: string;
  dimension_keys: DimensionKey[];
  sizes: { label: string; available_qty: number; dimensions: Record<DimensionKey, number | null> }[];
  has_dimensions: boolean;
}

// Which dimensions matter for each garment_type — mirrors the backend.
// Used in the seller new-item form to render only the relevant inputs.
export const DIMENSION_KEYS_BY_TYPE: Record<string, DimensionKey[]> = {
  shirt: ["chest_cm", "shoulder_cm", "sleeve_cm", "length_cm"],
  vest_under: ["chest_cm", "shoulder_cm", "length_cm"],
  waistcoat: ["chest_cm", "shoulder_cm", "length_cm"],
  outerwear: ["chest_cm", "shoulder_cm", "sleeve_cm", "length_cm"],
  dress: ["bust_cm", "waist_cm", "hips_cm", "length_cm"],
  skirt: ["waist_cm", "hips_cm", "length_cm"],
  trousers: ["waist_cm", "hips_cm", "inseam_cm", "rise_cm"],
  shorts: ["waist_cm", "hips_cm", "inseam_cm"],
  belt: ["waist_cm", "length_cm"],
  tie: ["length_cm"],
  scarf: ["length_cm"],
  socks: [],
  shoes: [],
  hat: [],
  bag: [],
  jewelry: [],
  other: [],
};

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  chest_cm: "Chest",
  shoulder_cm: "Shoulder",
  sleeve_cm: "Sleeve",
  length_cm: "Length",
  waist_cm: "Waist",
  hips_cm: "Hips",
  inseam_cm: "Inseam",
  rise_cm: "Rise",
  bust_cm: "Bust",
};

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
  brand_name?: string | null;
  category: string;
  subcategory?: string | null;
  price_cents: number;
  currency: CurrencyCode;
  garment_type: GarmentType;
  image_b64: string;
  // Full photo gallery (primary first). Always at least 1 entry.
  images?: string[];
  sizes: SizeOption[];
  colors: ColorOption[];
  audience: Audience;
  created_at: string;
}

export interface PayoutRow {
  id: string;
  item_id?: string;
  item_name: string;
  size: string;
  color?: string | null;
  currency: CurrencyCode;
  amount_cents: number;
  platform_fee_cents: number;
  seller_net_cents: number;
  status: string;
  created_at: string;
}

export interface PayoutHistory {
  platform_fee_bps: number;
  connect_status: ConnectStatusCode;
  payouts: PayoutRow[];
  totals: {
    count: number;
    gross_cents: number;
    platform_fee_cents: number;
    net_cents: number;
  };
}

// Display-name remap so sellers see industry-standard category names
// (Tops/Bottoms/...) while the backend keeps stable enum values.
export const CATEGORY_LABELS: Record<string, string> = {
  shirts: "Tops",
  dresses: "Dresses",
  pants: "Bottoms",
  outerwear: "Outerwear",
  shoes: "Shoes",
  accessories: "Accessories",
};

// Curated subcategory taxonomy — shown as the Subcategory dropdown in the
// seller upload wizard. Mirrors the buyer-facing taxonomy so search/filter
// stays consistent. Expanded in iter 14 to cover more real-world styles.
export const SUBCATEGORIES_BY_CATEGORY: Record<string, string[]> = {
  shirts: [
    "T-shirt",
    "Button-up",
    "Polo",
    "Knit",
    "Blouse",
    "Tank top",
    "Hoodie",
    "Sweatshirt",
  ],
  dresses: ["Mini", "Midi", "Maxi", "Gown", "Skirt"],
  pants: [
    "Jeans",
    "Chinos",
    "Trousers",
    "Joggers",
    "Leggings",
    "Shorts",
    "Cargo",
  ],
  outerwear: [
    "Blazer",
    "Jacket",
    "Coat",
    "Vest/Waistcoat",
    "Parka",
    "Trench",
    "Bomber",
    "Puffer",
  ],
  shoes: ["Sneakers", "Heels", "Boots", "Flats", "Sandals", "Loafers"],
  accessories: ["Belt", "Hat", "Bag", "Scarf", "Jewelry", "Tie", "Watch", "Sunglasses"],
};

// Audience → categories the seller can pick from. Mirrors what shoppers
// actually expect to see on each side of the marketplace. Men/Unisex hide
// dresses (rarely listed for men); Women/Kids see everything. Sellers
// can still find any category by switching audience.
export const CATEGORIES_BY_AUDIENCE: Record<string, string[]> = {
  women: ["shirts", "dresses", "pants", "outerwear", "shoes", "accessories"],
  men: ["shirts", "pants", "outerwear", "shoes", "accessories"],
  unisex: ["shirts", "pants", "outerwear", "shoes", "accessories"],
  kids: ["shirts", "dresses", "pants", "outerwear", "shoes", "accessories"],
};

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

export type OrderStatus =
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "in_fulfillment"
  | "shipped"
  | "delivered";

export interface Order {
  id: string;
  buyer_id: string;
  item_id: string;
  item_name: string;
  size: string;
  color?: string | null;
  amount_cents: number;
  currency: CurrencyCode;
  status: OrderStatus;
  fit_feedback?: "small" | "perfect" | "large" | null;
  session_id: string;
  created_at: string;
  // Fulfillment metadata (null until the seller advances the order)
  tracking_number?: string | null;
  tracking_url?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  fulfillment_note?: string | null;
}

export type FitFeedback = "small" | "perfect" | "large";

export interface OrderSeller {
  id: string;
  full_name: string;
  company_name?: string | null;
  location?: Location | null;
  payout_summary?: string | null;
}

export interface OrderDetail extends Order {
  seller_id: string;
  platform_fee_cents: number;
  seller_net_cents: number;
  item_image_b64?: string | null;
  item_garment_type?: string | null;
  fit_feedback_comment?: string | null;
  seller?: OrderSeller | null;
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
  connect_status: ConnectStatusCode;
  platform_fee_bps: number;
  items: ItemAnalytics[];
}

export interface ConnectStatus {
  stripe_account_id?: string | null;
  connect_status: ConnectStatusCode;
  onboarding_url?: string | null;
  platform_fee_bps: number;
  note?: string | null;
}

export type ProfileAudience = "adult" | "kid";

export interface LovedOne {
  id: string;
  user_id: string;
  name: string;
  audience: ProfileAudience;
  gender?: Gender | null;
  age?: number | null;
  relation?: string | null;
  measurements: Measurements;
  preferred_size?: string | null;
  has_front_photo: boolean;
  has_side_photo: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfileSummary {
  id: string; // "self" or LovedOne uuid
  is_self: boolean;
  name: string;
  audience: ProfileAudience;
  gender?: Gender | null;
  age?: number | null;
  has_front_photo: boolean;
  has_side_photo: boolean;
  preferred_size?: string | null;
}

export interface ActiveProfile {
  profile_id: string;
  profile: ProfileSummary;
}

export type AddressLabel = "home" | "office" | "parents" | "other";

export interface Address {
  id: string;
  user_id: string;
  label: AddressLabel;
  custom_label?: string | null;
  recipient_name: string;
  phone: string;
  alt_phone?: string | null;
  building_estate?: string | null;
  house_number?: string | null;
  street?: string | null;
  area?: string | null;
  city: string;
  postal_code?: string | null;
  country: string;
  delivery_notes?: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AddressInput {
  label: AddressLabel;
  custom_label?: string;
  recipient_name: string;
  phone: string;
  alt_phone?: string;
  building_estate?: string;
  house_number?: string;
  street?: string;
  area?: string;
  city: string;
  postal_code?: string;
  country: string;
  delivery_notes?: string;
  is_default?: boolean;
}

export type KidAgeGroup = "0-2" | "3-5" | "6-9" | "10-13" | "14-17";

export interface WishlistEntry {
  item: Item;
  added_at: string;
  restocked: boolean;
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

// Admin types
export interface AdminAnalytics {
  total_users: number;
  buyers: number;
  sellers: number;
  admins: number;
  suspended: number;
  total_items: number;
  total_orders: number;
  total_paid_orders: number;
  total_revenue_cents: number;
  total_platform_fee_cents: number;
  total_net_to_sellers_cents: number;
  pending_connect_sellers: number;
  top_sellers: { seller_id: string; name: string; revenue_cents: number; orders: number }[];
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
    gender?: Gender | null;
    age?: number;
    dob?: string;
    preferred_currency?: CurrencyCode;
    // Seller-only
    company_name?: string;
    location?: Location;
    bank_details?: BankDetails;
  }) => request<AuthEnvelope>("/auth/register", { method: "POST", body, auth: false }),
  login: (body: {
    email: string;
    password: string;
    as_role?: "buyer" | "seller";
  }) => request<AuthEnvelope>("/auth/login", { method: "POST", body, auth: false }),
  me: () => request<User>("/auth/me"),
  updatePreferences: (body: { preferred_currency?: CurrencyCode }) =>
    request<User>("/auth/preferences", { method: "PATCH", body }),

  // Role toggle (POST /user/toggle-role) — returns a fresh JWT carrying the
  // new role + bumped token_version. Caller MUST persist the new token and
  // discard the previous one (which is now rejected server-side).
  toggleRole: (body: {
    to?: "buyer" | "seller";
    company_name?: string;
    location?: Location;
    bank_details?: BankDetails;
  } = {}) =>
    request<AuthEnvelope>("/user/toggle-role", { method: "POST", body }),

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
    kid_age_group?: KidAgeGroup;
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
    brand_name?: string;
    category: string;
    subcategory?: string;
    price_cents: number;
    currency?: CurrencyCode;
    image_b64: string;
    extra_images?: string[];
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
    profile_id?: string;
    angles?: TryOnAngle[];
  }) => request<TryOnResult>("/tryon", { method: "POST", body }),
  tryOnOutfit: (body: {
    item_ids: string[];
    use_profile_photo?: boolean;
    body_photo_b64?: string;
    profile_id?: string;
    angles?: TryOnAngle[];
  }) => request<TryOnResult>("/tryon/outfit", { method: "POST", body }),
  tryOnGarment: (body: {
    garment_b64: string;
    garment_type?: string;
    label?: string;
    use_profile_photo?: boolean;
    body_photo_b64?: string;
    profile_id?: string;
    angles?: TryOnAngle[];
  }) => request<TryOnResult>("/tryon/garment", { method: "POST", body }),
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
  sellerOrders: (params: { status?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.append("status", params.status);
    const suffix = qs.toString();
    return request<Order[]>(`/seller/orders${suffix ? `?${suffix}` : ""}`);
  },
  sellerPayouts: () => request<PayoutHistory>("/seller/payouts"),
  sellerUpdateFulfillment: (
    orderId: string,
    body: {
      action: "acknowledge" | "ship" | "deliver";
      tracking_number?: string;
      tracking_url?: string;
      note?: string;
    },
  ) =>
    request<{ status: "ok"; order: Order }>(
      `/seller/orders/${encodeURIComponent(orderId)}/fulfillment`,
      { method: "POST", body },
    ),
  updatePayoutDetails: (body: BankDetails) =>
    request<User>("/seller/payout-details", { method: "PATCH", body }),
  updateSellerProfile: (body: { company_name?: string; location?: Location }) =>
    request<User>("/seller/profile", { method: "PATCH", body }),
  connectStatus: () => request<ConnectStatus>("/seller/connect/status"),
  connectSetup: (body: { return_url?: string } = {}) =>
    request<ConnectStatus>("/seller/connect/setup", { method: "POST", body }),
  patchItem: (id: string, body: { sizes?: SizeOption[] }) =>
    request<Item>(`/items/${id}`, { method: "PATCH", body }),
  itemSizeGuide: (id: string) => request<SizeGuide>(`/items/${id}/size-guide`),

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

  // Order fit feedback + detail
  orderDetail: (id: string) => request<OrderDetail>(`/orders/${id}`),
  orderFeedback: (id: string, body: { fit: FitFeedback; comment?: string }) =>
    request<OrderDetail>(`/orders/${id}/feedback`, { method: "POST", body }),

  // Payments
  checkout: (body: {
    item_id: string;
    size: string;
    color?: string;
    origin_url: string;
    address_id: string;
  }) =>
    request<{ session_id: string; url: string }>("/payments/checkout", { method: "POST", body }),
  paymentStatus: (sessionId: string) =>
    request<{ session_id: string; status: string; item_name: string; amount_cents: number }>(
      `/payments/status/${sessionId}`,
    ),
  orders: () => request<Order[]>("/orders"),

  // Admin
  adminAnalytics: () => request<AdminAnalytics>("/admin/analytics"),
  adminListUsers: (params: { role?: Role; suspended?: boolean; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.role) qs.append("role", params.role);
    if (params.suspended !== undefined) qs.append("suspended", String(params.suspended));
    if (params.q) qs.append("q", params.q);
    const suffix = qs.toString();
    return request<User[]>(`/admin/users${suffix ? `?${suffix}` : ""}`);
  },
  adminGetUser: (userId: string) => request<User>(`/admin/users/${userId}`),
  adminPatchUser: (
    userId: string,
    body: { suspended?: boolean; connect_status?: ConnectStatusCode; company_name?: string },
  ) => request<User>(`/admin/users/${userId}`, { method: "PATCH", body }),
  adminListOrders: (params: { status?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.append("status", params.status);
    const suffix = qs.toString();
    return request<Order[]>(`/admin/orders${suffix ? `?${suffix}` : ""}`);
  },
  adminListItems: () => request<Item[]>("/admin/items"),
  adminDeleteItem: (itemId: string) =>
    request<{ ok: boolean }>(`/admin/items/${itemId}`, { method: "DELETE" }),

  // Loved-ones (alternate body profiles) + active profile switcher
  listLovedOnes: () => request<LovedOne[]>("/loved-ones"),
  createLovedOne: (body: {
    name: string;
    audience: ProfileAudience;
    gender?: Gender | null;
    age?: number | null;
    relation?: string;
    measurements?: Measurements;
    preferred_size?: string | null;
    front_photo_b64?: string;
    side_photo_b64?: string;
  }) => request<LovedOne>("/loved-ones", { method: "POST", body }),
  updateLovedOne: (
    id: string,
    body: Partial<{
      name: string;
      audience: ProfileAudience;
      gender: Gender | null;
      age: number | null;
      relation: string;
      measurements: Measurements;
      preferred_size: string | null;
      front_photo_b64: string;
      side_photo_b64: string;
    }>,
  ) => request<LovedOne>(`/loved-ones/${id}`, { method: "PATCH", body }),
  deleteLovedOne: (id: string) =>
    request<{ ok: boolean }>(`/loved-ones/${id}`, { method: "DELETE" }),
  listProfiles: () => request<ProfileSummary[]>("/profiles/all"),
  getActiveProfile: () => request<ActiveProfile>("/profiles/active"),
  setActiveProfile: (profile_id: string) =>
    request<ActiveProfile>("/profiles/active", { method: "POST", body: { profile_id } }),

  // Delivery addresses (multi-address book)
  listAddresses: () => request<Address[]>("/addresses"),
  createAddress: (body: AddressInput) =>
    request<Address>("/addresses", { method: "POST", body }),
  getAddress: (id: string) => request<Address>(`/addresses/${id}`),
  updateAddress: (id: string, body: Partial<AddressInput>) =>
    request<Address>(`/addresses/${id}`, { method: "PATCH", body }),
  setDefaultAddress: (id: string) =>
    request<Address>(`/addresses/${id}/default`, { method: "POST" }),
  deleteAddress: (id: string) =>
    request<{ ok: boolean }>(`/addresses/${id}`, { method: "DELETE" }),
};

export const BACKEND_URL = BASE_URL;

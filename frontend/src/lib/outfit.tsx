// Active-outfit context (in-memory + AsyncStorage). The user stages up to 8
// garments at once for multi-item virtual try-on. Layering hierarchy comes
// from /app/backend/models.py — keep these constants in sync.
//
// Implemented with React Context instead of Zustand to keep Metro's web
// bundler happy (zustand's ESM build uses `import.meta` which Metro web
// rejects). This module owns the entire client-side outfit state.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { GarmentType, Item } from "@/src/lib/api";
import { storage } from "@/src/utils/storage";

export interface OutfitItem {
  id: string;
  name: string;
  seller_name: string;
  image_b64: string;
  garment_type: GarmentType;
}

// Lower → closer to the body. Matches the backend's LAYER_ORDER exactly.
export const LAYER_ORDER: Record<GarmentType, number> = {
  vest_under: 10,
  shirt: 20,
  dress: 25,
  skirt: 30,
  trousers: 30,
  shorts: 30,
  belt: 40,
  waistcoat: 45,
  tie: 50,
  scarf: 52,
  outerwear: 55,
  socks: 60,
  shoes: 65,
  hat: 70,
  bag: 90,
  jewelry: 92,
  other: 100,
};

export function layerLabel(g: GarmentType): string {
  switch (g) {
    case "vest_under":
      return "Undershirt";
    case "shirt":
      return "Shirt";
    case "dress":
      return "Dress";
    case "skirt":
      return "Skirt";
    case "trousers":
      return "Trousers";
    case "shorts":
      return "Shorts";
    case "belt":
      return "Belt";
    case "waistcoat":
      return "Waistcoat";
    case "tie":
      return "Tie";
    case "scarf":
      return "Scarf";
    case "outerwear":
      return "Jacket";
    case "socks":
      return "Socks";
    case "shoes":
      return "Shoes";
    case "hat":
      return "Hat";
    case "bag":
      return "Bag";
    case "jewelry":
      return "Jewellery";
    default:
      return "Piece";
  }
}

/**
 * Human-readable styling rules derived from the items currently in the outfit.
 * Mirrors the backend's _build_outfit_rules so the user sees the same logic
 * the AI will obey.
 */
export function deriveOutfitRules(items: OutfitItem[]): string[] {
  const types = new Set(items.map((i) => i.garment_type));
  const rules: string[] = [];
  const hasTop = types.has("shirt");
  if (types.has("belt") && hasTop)
    rules.push("Shirt tucked into the trousers — belt visible.");
  if (types.has("vest_under") && hasTop)
    rules.push("Vest hidden beneath the shirt.");
  if (types.has("waistcoat") && hasTop)
    rules.push("Waistcoat layered over the shirt.");
  if (types.has("tie") && hasTop)
    rules.push("Tie sits at the neck over the collar.");
  if (types.has("outerwear")) rules.push("Jacket is the outermost layer.");
  if (types.has("shorts") && types.has("socks"))
    rules.push("Socks visible on the lower legs above the shoes.");
  if (types.has("scarf")) rules.push("Scarf draped around the neck.");
  return rules;
}

export function sortByLayer(items: OutfitItem[]): OutfitItem[] {
  return [...items].sort(
    (a, b) =>
      (LAYER_ORDER[a.garment_type] ?? 100) - (LAYER_ORDER[b.garment_type] ?? 100),
  );
}

const STORAGE_KEY = "drape.outfit.v1";
const MAX_ITEMS = 8;

interface OutfitContextValue {
  items: OutfitItem[];
  add: (item: Item) => void;
  remove: (id: string) => void;
  clear: () => void;
  isInOutfit: (id: string) => boolean;
}

const OutfitCtx = createContext<OutfitContextValue | null>(null);

export function OutfitProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<OutfitItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from storage on mount.
  useEffect(() => {
    (async () => {
      try {
        const raw = await storage.getItem<string>(STORAGE_KEY, "");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setItems(parsed as OutfitItem[]);
        }
      } catch {
        // ignore malformed storage
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // Persist on every change (after hydration).
  useEffect(() => {
    if (!hydrated) return;
    storage.setItem(STORAGE_KEY, JSON.stringify(items)).catch(() => {});
  }, [items, hydrated]);

  const add = useCallback((item: Item) => {
    setItems((curr) => {
      if (curr.some((x) => x.id === item.id)) return curr;
      if (curr.length >= MAX_ITEMS) return curr;
      const snap: OutfitItem = {
        id: item.id,
        name: item.name,
        seller_name: item.seller_name,
        image_b64: item.image_b64,
        garment_type: item.garment_type,
      };
      return [...curr, snap];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems((curr) => curr.filter((x) => x.id !== id));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const isInOutfit = useCallback(
    (id: string) => items.some((x) => x.id === id),
    [items],
  );

  const value = useMemo<OutfitContextValue>(
    () => ({ items, add, remove, clear, isInOutfit }),
    [items, add, remove, clear, isInOutfit],
  );

  return <OutfitCtx.Provider value={value}>{children}</OutfitCtx.Provider>;
}

/**
 * Mirrors the zustand selector API used elsewhere in the codebase. Pass a
 * selector to subscribe to a slice of the outfit state.
 */
export function useOutfit<T>(selector: (s: OutfitContextValue) => T): T {
  const ctx = useContext(OutfitCtx);
  if (!ctx) {
    throw new Error("useOutfit must be used within <OutfitProvider>");
  }
  return selector(ctx);
}

// Type stub only. Metro always resolves the platform-specific
// implementation at build time — SellerMap.native.tsx on iOS/Android and
// SellerMap.web.tsx on web — so this file never runs. It exists purely so
// TypeScript can resolve `@/src/components/SellerMap` to a typed default.
import type { ComponentType } from "react";

export interface SellerMapProps {
  lat: number;
  lon: number;
  accent?: string;
}

const SellerMap: ComponentType<SellerMapProps> = () => null;

export default SellerMap;

// Allow importing stylesheet side-effects on web (e.g. leaflet's CSS).
// Native never imports these — only the SellerMap.web.tsx map does.
declare module "*.css";

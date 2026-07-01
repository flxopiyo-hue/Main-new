// Tiny external-store for the "View as buyer" preview mode used by
// sellers to peek into the buyer-facing experience without flipping
// their actual role server-side.
//
// While `previewAsBuyer` is true, the buyer tabs layout skips the RBAC
// redirect that normally bounces sellers back to /(seller). A small
// floating banner in BuyerTabsLayout reminds the seller they are in
// preview mode and offers a one-tap "Exit preview" CTA.
//
// The flag is intentionally in-memory only — leaving the app or
// reloading clears the preview so we never strand a seller in the wrong
// portal across sessions.
//
// Implemented with React 18's `useSyncExternalStore` instead of zustand
// because zustand's ESM build uses `import.meta` which Metro web
// currently rejects (see /src/lib/outfit.tsx for the same workaround).

import { useSyncExternalStore } from "react";

let previewAsBuyer = false;
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function emit(): void {
  listeners.forEach((cb) => cb());
}

function getSnapshot(): boolean {
  return previewAsBuyer;
}

/** Read-only hook: components re-render whenever the flag flips. */
export function usePreviewAsBuyer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function enterPreview(): void {
  if (previewAsBuyer) return;
  previewAsBuyer = true;
  emit();
}

export function exitPreview(): void {
  if (!previewAsBuyer) return;
  previewAsBuyer = false;
  emit();
}

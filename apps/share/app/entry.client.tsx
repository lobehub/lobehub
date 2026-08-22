import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';

import { ensureBuiltinToolSurfaces } from '@/spa/initialize/toolSurfaces';

// RR suffixes dynamically-shared route CSS hrefs with `#`, so the vite preload
// helper re-requests them with `crossorigin` — against our cross-origin CDN the
// browser reuses the plain-cached (ACAO-less) response and fails the CORS
// check, which would otherwise crash route loading. The stylesheet is already
// applied via RR's own link, so a failed duplicate preload is safe to ignore.
// Must attach here (first client module) — route chunks load in parallel with
// root.tsx, so a root-level listener can miss the event.
window.addEventListener('vite:preloadError', (event) => {
  const payload = (event as Event & { payload?: Error }).payload;
  if (String(payload).includes('CSS')) {
    console.warn('[share] ignored css preload failure:', payload);
    event.preventDefault();
  }
});

// The conversation route blocks its first render on this registry, whose own
// dependency chain is several round trips deep. Kicking it off with the entry
// — rather than when the gated chunk mounts — overlaps it with hydration.
void ensureBuiltinToolSurfaces();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});

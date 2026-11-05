import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';

// In production the worker inlines this before the document is served. The dev
// server has no such stage, so fetch it through vite's API proxy instead —
// after hydration, which is when `AuthAppShell` first reads it either way.
const loadDevServerConfig = async () => {
  if (!import.meta.env.DEV) return;

  try {
    const response = await fetch('/webapi/auth/spa-config');
    if (response.ok) window.__SERVER_CONFIG__ = await response.json();
  } catch {
    // Rendering config-less is the same state a failed lookup gives in production.
  }
};

void loadDevServerConfig();

// No index.html in this app, so the StyleX unplugin cannot inject its dev CSS;
// load it from the Vite dev server instead. Production CSS is linked by root.tsx.
if (import.meta.env.DEV) void import('virtual:lobe-stylex-dev-css');

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});

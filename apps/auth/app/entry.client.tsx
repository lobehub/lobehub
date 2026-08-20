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

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});

/**
 * Preload Tool Render components to avoid Suspense flash on first expand
 *
 * These components are dynamically imported in Tool/Tool/index.tsx.
 * By preloading them when tool calls are detected, we can avoid
 * the loading skeleton flash when user first expands the tool result.
 */

let preloaded = false;

export const preloadToolRenderComponents = () => {
  if (preloaded) return;
  preloaded = true;

  // Preload Detail and Debug components (dynamic imports in Tool/Tool/index.tsx)
  import('../AssistantGroup/Tool/Detail');
  import('../AssistantGroup/Tool/Debug');
};

import { useServerConfigStore } from '@/store/serverConfig';

export type QuickNoteRouteAccess = 'allowed' | 'denied' | 'pending';

/**
 * Decides whether the Quick Note route may render.
 *
 * Use when:
 * - A direct Quick Note route must wait for the server feature flags before redirecting.
 *
 * Expects:
 * - The server config store reports `serverConfigInit` once feature flags are resolved.
 *
 * Returns:
 * - `'pending'` until flags resolve, then `'allowed'` or `'denied'`. Note data loads only
 *   after the route renders its content, so a denied user never fetches notes.
 */
export const useQuickNoteRouteAccess = (): QuickNoteRouteAccess => {
  const [initialized, enabled] = useServerConfigStore((s) => [
    s.serverConfigInit,
    s.featureFlags.enableQuickNote,
  ]);

  if (!initialized) return 'pending';
  return enabled ? 'allowed' : 'denied';
};

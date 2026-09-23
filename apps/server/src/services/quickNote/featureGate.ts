import { TRPCError } from '@trpc/server';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/**
 * Requires Quick Note access for the current user.
 *
 * Use when:
 * - A request enters the Quick Note API.
 *
 * Expects:
 * - The authenticated user ID, evaluated against the published rollout configuration.
 *
 * Returns:
 * - Resolves for enabled users; otherwise throws FORBIDDEN before accessing note data.
 */
export const assertQuickNoteEnabled = async (userId: string) => {
  const flags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
  if (flags.enableQuickNote !== true) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Quick Note is not enabled' });
  }
};

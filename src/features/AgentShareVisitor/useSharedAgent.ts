import useSWR, { mutate } from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { agentShareService } from '@/services/agentShare';

export const sharedAgentSWRConfig = {
  revalidateOnFocus: false,
  // getSharedAgent tracks a view; reconnecting the same mounted visit must not increment it again.
  revalidateOnReconnect: false,
} as const;

/**
 * Fetch the visitor-facing metadata of an agent share.
 *
 * Shared by the route layout, page, and dynamic route meta — all three read
 * the same SWR key so only one request is issued.
 */
export const useSharedAgent = (shareId?: string) =>
  useSWR(
    shareId ? shareKeys.agentInfo(shareId) : null,
    () => agentShareService.getSharedAgent(shareId!),
    sharedAgentSWRConfig,
  );

/**
 * Re-check a share's visitor-facing status (currently just `budgetExhausted`)
 * without counting another page view, and push the result into the shared
 * `useSharedAgent` SWR cache so every reader (page, layout, composer) picks
 * it up on next render.
 *
 * Lets the visitor composer offer an explicit "Retry" after a block — e.g.
 * once the owner tops up the share's budget — instead of requiring a full
 * page reload while still keeping page-view counting single-fire.
 */
export const refreshSharedAgentStatus = (shareId: string) =>
  mutate(shareKeys.agentInfo(shareId), () => agentShareService.getSharedAgent(shareId, false), {
    revalidate: false,
  });

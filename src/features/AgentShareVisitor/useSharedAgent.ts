import useSWR from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { agentShareService } from '@/services/agentShare';

/**
 * Fetch the visitor-facing metadata of an agent share, resolved from the URL
 * segment (a custom slug or the raw share id).
 *
 * `getSharedAgent` counts a page view server-side, so revalidation on focus /
 * reconnect is off: re-focusing the same mounted visit must not increment it
 * again.
 */
export const useSharedAgent = (slugOrId?: string) =>
  useSWR(
    slugOrId ? shareKeys.agentInfo(slugOrId) : null,
    () => agentShareService.getSharedAgent(slugOrId!),
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

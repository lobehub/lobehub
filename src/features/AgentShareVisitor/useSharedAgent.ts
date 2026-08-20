import useSWR from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { agentShareService } from '@/services/agentShare';

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
    { revalidateOnFocus: false },
  );

import useSWR from 'swr';

import { messageService } from '@/services/message';

/**
 * Fetch the stored tool payload for a message the read path projected.
 *
 * Gate `enabled` on a real user action — opening the detail portal, unfolding a
 * raw viewer. Tying it to render instead would pull every omitted payload back
 * down as soon as a conversation loads, which is the exact cost the projection
 * exists to avoid.
 */
export const useToolResultPayload = (messageId: string | undefined, enabled: boolean) => {
  const { data, isLoading } = useSWR(
    enabled && messageId ? ['toolResultPayload', messageId] : null,
    ([, id]: [string, string]) => messageService.getToolResultPayload(id),
    { revalidateOnFocus: false },
  );

  return { isLoading: enabled && isLoading, payload: data };
};

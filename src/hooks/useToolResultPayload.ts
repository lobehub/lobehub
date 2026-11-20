import { useToolResultPayloadStore } from '@/store/toolResultPayload/store';

/**
 * Fetch the stored tool payload for a message the read path projected.
 *
 * Gate `enabled` on a real user action — opening the detail portal, unfolding a
 * raw viewer. Tying it to render instead would pull every omitted payload back
 * down as soon as a conversation loads, which is the exact cost the projection
 * exists to avoid.
 *
 * The payload is a replica keyed by message id (`toolResultPayloadResource`),
 * so after a reload the card paints the persisted copy at once and the read
 * confirms it behind it.
 */
export const useToolResultPayload = (messageId: string | undefined, enabled: boolean) => {
  const params = enabled && messageId ? messageId : null;
  const stored = useToolResultPayloadStore((s) =>
    params ? s.toolResultPayloadMap[params] : undefined,
  );
  const { error, isHydrated, isValidating } = useToolResultPayloadStore
    .getState()
    .payload.useSync(params, { revalidateOnFocus: false });

  return {
    isLoading: !!params && stored === undefined && !error && (!isHydrated || isValidating),
    payload: stored?.value,
  };
};

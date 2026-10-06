import type { FollowUpExtractInput, FollowUpExtractResult } from '@lobechat/types';

import { lambdaClient, withLlmRelay } from '@/libs/trpc/client';
import { oneShotRelay } from '@/services/llmRelay';

class FollowUpActionService {
  /**
   * Extract chips for a message. Returns null on abort or any failure (silent).
   */
  async extract(
    input: FollowUpExtractInput,
    signal?: AbortSignal,
  ): Promise<FollowUpExtractResult | null> {
    try {
      // A device-only model is relayed back to this tab (one-shot relay).
      const result = await oneShotRelay.run(input.modelConfig?.provider, (relay) =>
        lambdaClient.followUpAction.extract.mutate(input, { signal, ...withLlmRelay(relay) }),
      );
      return result;
    } catch (err) {
      // TRPC wraps DOMException in TRPCClientError, so check both the raw error
      // and the original signal — silent on any abort flow (timeout, manual clear).
      if (signal?.aborted) return null;
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      console.warn('[FollowUpAction] extract failed', err);
      return null;
    }
  }
}

export const followUpActionService = new FollowUpActionService();

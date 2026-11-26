import type { ModelReasoning } from '@lobechat/types';

import { hasRenderableReasoning } from '../components/Reasoning';

/**
 * Whether reasoning must be rendered next to the error card. `ChatItem` renders only the
 * error card for an errored message with empty content and drops its children, so reasoning
 * streamed before the error (for example, a step stopped mid-thought) would disappear.
 */
export const shouldShowReasoningAboveError = ({
  hasEmptyErrorMessage,
  reasoning,
}: {
  hasEmptyErrorMessage: boolean;
  reasoning?: ModelReasoning | null;
}): boolean => hasEmptyErrorMessage && hasRenderableReasoning(reasoning);

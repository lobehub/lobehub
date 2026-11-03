import { type MessageContentPart, type ModelReasoning } from '@lobechat/types';
import { deserializeParts } from '@lobechat/utils';
import { memo } from 'react';

import Thinking from '@/features/Conversation/components/Thinking';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { messageStateSelectors, useConversationStore } from '../../store';
import { RichContentRenderer } from './RichContentRenderer';

/**
 * Whether a persisted reasoning object holds renderable thinking. A
 * signature-only reasoning ({ signature } without content) is protocol state
 * kept for multi-turn replay and must not render an empty "deep thought" card.
 * Multimodal reasoning streams image parts via tempDisplayContent
 * without content, so those count as renderable.
 */
export const hasRenderableReasoning = (reasoning?: ModelReasoning | null): boolean =>
  !!reasoning?.content?.trim() || !!reasoning?.tempDisplayContent?.length;

interface ReasoningProps {
  content?: string;
  duration?: number;
  id: string;
  isMultimodal?: boolean;
  tempDisplayContent?: MessageContentPart[];
}

const Reasoning = memo<ReasoningProps>(
  ({ content = '', duration, id, isMultimodal, tempDisplayContent }) => {
    const isReasoning = useConversationStore(messageStateSelectors.isMessageInReasoning(id));
    const transitionMode = useUserStore(userGeneralSettingsSelectors.transitionMode);

    const parts = tempDisplayContent || deserializeParts(content);

    // If parts are provided, render multimodal content
    const thinkingContent = isMultimodal && parts ? <RichContentRenderer parts={parts} /> : content;

    return (
      <Thinking
        content={thinkingContent}
        duration={duration}
        thinking={isReasoning}
        thinkingAnimated={transitionMode === 'fadeIn' && isReasoning}
      />
    );
  },
);

export default Reasoning;

import type {MessageContentPart} from '@lobechat/types';
import { deserializeParts } from '@lobechat/utils';
import { memo } from 'react';

import Thinking from '@/features/Conversation/components/Thinking';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { messageStateSelectors, useConversationStore } from '../../store';
import { RichContentRenderer } from './RichContentRenderer';

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

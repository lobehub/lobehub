import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import { useErrorContent } from '@/features/Conversation/Error';
import { type AssistantContentBlock } from '@/types/index';

import ErrorContent from '../../../ChatItem/components/ErrorContent';
import { messageStateSelectors, useConversationStore } from '../../../store';
import { Tools } from '../../AssistantGroup/Tools';
import Reasoning from '../../components/Reasoning';
import MessageContent from './MessageContent';

const ContentBlock = memo<AssistantContentBlock>(({ id, tools, content, reasoning, error }) => {
  const errorContent = useErrorContent(error);
  const isReasoning = useConversationStore(messageStateSelectors.isMessageInReasoning(id));
  const hasTools = tools && tools.length > 0;
  const showReasoning =
    (!!reasoning && reasoning.content?.trim() !== '') || (!reasoning && isReasoning);

  if (error && (content === LOADING_FLAT || !content))
    return (
      <ErrorContent
        error={
          errorContent && error && (content === LOADING_FLAT || !content) ? errorContent : undefined
        }
        id={id}
      />
    );

  return (
    <Flexbox gap={8} id={id}>
      {showReasoning && <Reasoning {...reasoning} id={id} />}

      {/* Content - markdown text */}
      <MessageContent content={content} hasTools={hasTools} id={id} />

      {/* Tools */}
      {hasTools && <Tools messageId={id} tools={tools} />}
    </Flexbox>
  );
});

export default ContentBlock;

import { Flexbox, Highlighter } from '@lobehub/ui';
import { memo, useCallback } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';
import { LOADING_FLAT } from '@/const/message';
import { useErrorContent } from '@/features/Conversation/Error';

import ErrorContent from '../../../ChatItem/components/ErrorContent';
import { messageStateSelectors, useConversationStore } from '../../../store';
import ImageFileListViewer from '../../components/ImageFileListViewer';
import Reasoning from '../../components/Reasoning';
import { Tools } from '../Tools';
import MessageContent from './MessageContent';
import type { RenderableAssistantContentBlock } from './types';

interface ContentBlockProps extends RenderableAssistantContentBlock {
  assistantId: string;
  disableEditing?: boolean;
}
const ContentBlock = memo<ContentBlockProps>(
  ({ id, tools, content, imageList, reasoning, error, domId, assistantId, disableEditing }) => {
    const errorContent = useErrorContent(error);
    const showImageItems = !!imageList && imageList.length > 0;
    const [isReasoning, deleteMessage, continueGeneration] = useConversationStore((s) => [
      messageStateSelectors.isMessageInReasoning(id)(s),
      s.deleteDBMessage,
      s.continueGeneration,
    ]);
    const hasTools = tools && tools.length > 0;
    const showReasoning =
      (!!reasoning && reasoning.content?.trim() !== '') || (!reasoning && isReasoning);
    const hasContent = !!content && content !== LOADING_FLAT;
    const showMessageContent = hasContent || content === LOADING_FLAT || hasTools;

    const handleRegenerate = useCallback(async () => {
      await deleteMessage(id);
      continueGeneration(assistantId);
    }, [assistantId, continueGeneration, deleteMessage, id]);

    if (error && (content === LOADING_FLAT || !content)) {
      return (
        <ErrorContent
          id={id}
          error={
            errorContent && error && (content === LOADING_FLAT || !content)
              ? {
                  ...errorContent,
                  extra: error?.body && (
                    <Highlighter
                      actionIconSize={'small'}
                      language={'json'}
                      padding={8}
                      variant={'borderless'}
                    >
                      {JSON.stringify(error?.body, null, 2)}
                    </Highlighter>
                  ),
                }
              : undefined
          }
          onRegenerate={handleRegenerate}
        />
      );
    }

    return (
      <Flexbox gap={8} id={domId ?? id}>
        {showReasoning && (
          <SafeBoundary>
            <Reasoning {...reasoning} id={id} />
          </SafeBoundary>
        )}

        {showMessageContent && (
          <SafeBoundary variant="alert">
            <MessageContent content={content} hasTools={hasTools} id={id} />
          </SafeBoundary>
        )}

        {showImageItems && (
          <SafeBoundary>
            <ImageFileListViewer items={imageList} />
          </SafeBoundary>
        )}

        {hasTools && (
          <SafeBoundary>
            <Tools disableEditing={disableEditing} messageId={id} tools={tools} />
          </SafeBoundary>
        )}
      </Flexbox>
    );
  },
);

export default ContentBlock;

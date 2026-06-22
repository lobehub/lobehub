import { Flexbox } from '@lobehub/ui';
import { memo, useCallback } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';
import { LOADING_FLAT } from '@/const/message';
import ErrorMessageExtra, { useErrorContent } from '@/features/Conversation/Error';

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
  ({
    id,
    tools,
    content,
    imageList,
    reasoning,
    error,
    domId,
    contentOverride,
    assistantId,
    disableEditing,
    disableMarkdownStreaming,
    hasToolsOverride,
  }) => {
    const errorContent = useErrorContent(error);
    const showImageItems = !!imageList && imageList.length > 0;
    const [isReasoning, deleteMessage, continueGeneration] = useConversationStore((s) => [
      messageStateSelectors.isMessageInReasoning(id)(s),
      s.deleteDBMessage,
      s.continueGeneration,
    ]);
    const hasTools = !!tools?.length;
    const showReasoning =
      (!!reasoning && reasoning.content?.trim() !== '') || (!reasoning && isReasoning);
    const hasContent = !!content && content !== LOADING_FLAT;
    const showMessageContent = hasContent || content === LOADING_FLAT || hasTools;

    const handleRegenerate = useCallback(async () => {
      await deleteMessage(id);
      continueGeneration(assistantId);
    }, [assistantId, continueGeneration, deleteMessage, id]);

    const errorBlock = error ? (
      <ErrorContent
        error={errorContent && error ? errorContent : undefined}
        id={id}
        customErrorRender={(alertError) => (
          <ErrorMessageExtra
            data={{ error, id }}
            error={alertError}
            onRegenerate={handleRegenerate}
          />
        )}
        onRegenerate={handleRegenerate}
      />
    ) : null;

    // Nothing was streamed before the turn died: the error stands in for the
    // whole block.
    if (error && (content === LOADING_FLAT || !content)) {
      return errorBlock;
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
            <MessageContent
              contentOverride={contentOverride}
              disableStreaming={disableMarkdownStreaming}
              hasToolsOverride={hasToolsOverride}
              id={id}
            />
          </SafeBoundary>
        )}

        {showImageItems && (
          <SafeBoundary>
            <ImageFileListViewer items={imageList} />
          </SafeBoundary>
        )}

        {hasTools && (
          <SafeBoundary>
            <Tools disableEditing={disableEditing} messageId={id} />
          </SafeBoundary>
        )}

        {/* A terminal error (e.g. upstream overload) can land on a turn that
            already streamed content + a successful tool call. Surface it below
            the content instead of silently dropping it. */}
        {errorBlock && <SafeBoundary>{errorBlock}</SafeBoundary>}
      </Flexbox>
    );
  },
);

export default ContentBlock;

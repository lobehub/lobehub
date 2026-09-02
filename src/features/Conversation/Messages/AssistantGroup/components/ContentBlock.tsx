import { Flexbox } from '@lobehub/ui';
import { memo, useCallback } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';
import { LOADING_FLAT } from '@/const/message';
import ErrorMessageExtra, { useErrorContent } from '@/features/Conversation/Error';

import ErrorContent from '../../../ChatItem/components/ErrorContent';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../../store';
import ImageFileListViewer from '../../components/ImageFileListViewer';
import Reasoning, { hasRenderableReasoning } from '../../components/Reasoning';
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
    projectionKey,
  }) => {
    const errorContent = useErrorContent(error);
    const showImageItems = !!imageList && imageList.length > 0;
    const [isReasoning, retryFailedAssistantStep] = useConversationStore((s) => [
      messageStateSelectors.isMessageInReasoning(id)(s),
      s.retryFailedAssistantStep,
    ]);
    // The group's parent user message id — the stable scope key for auto-retry
    // (survives the delete+recreate a retry performs) and the regenerate target.
    const groupParentId = useConversationStore(
      (s) => dataSelectors.getDisplayMessageById(assistantId)(s)?.parentId,
    );
    const hasTools = !!tools?.length;
    const showReasoning = hasRenderableReasoning(reasoning) || (!reasoning && isReasoning);
    const hasContent = !!content && content !== LOADING_FLAT;
    const showMessageContent = hasContent || content === LOADING_FLAT || hasTools;

    // The store owns the whole decision (resume a hetero session, continue the
    // group in place, or replace the turn) because only it can guarantee a
    // terminal outcome. Deleting the failed block here and then hoping
    // `continueGeneration` still found something to continue is what silently
    // ate the turn. Routed through the GROUP id — the child block id isn't a
    // top-level displayMessage.
    const handleRegenerate = useCallback(
      () => retryFailedAssistantStep(assistantId, id),
      [assistantId, id, retryFailedAssistantStep],
    );

    const errorBlock = error ? (
      <ErrorContent
        error={errorContent && error ? errorContent : undefined}
        id={id}
        customErrorRender={(alertError) => (
          <ErrorMessageExtra
            data={{ error, id }}
            error={alertError}
            retryScopeId={groupParentId}
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

    // A freshly created step block can mount before anything about it is
    // renderable — no content/reasoning has streamed yet and the reasoning op
    // hasn't started. Mounting the wrapper anyway would consume a flex `gap`
    // slot in the parent block list, visibly pushing the next sibling (e.g. the
    // message footer) down a beat before the block's content appears.
    if (!showReasoning && !showMessageContent && !showImageItems && !errorBlock) {
      return null;
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
            <Tools
              disableEditing={disableEditing}
              messageId={id}
              toolIds={projectionKey ? tools?.map((tool) => tool.id) : undefined}
            />
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

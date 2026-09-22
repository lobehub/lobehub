import { getBuiltinStreaming } from '@lobechat/builtin-tools/streamings';
import { type ChatToolResult, type ToolIntervention } from '@lobechat/types';
import { safeParsePartialJSON } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import { memo, Suspense } from 'react';

import { useIsTimedOutUnanswered } from '../../../../hooks/useDeadlineClock';
import AbortResponse from './AbortResponse';
import LoadingPlaceholder from './LoadingPlaceholder';
import RejectedResponse from './RejectedResponse';
import ToolRender from './Render';

interface RenderProps {
  apiName: string;
  arguments?: string;
  disableEditing?: boolean;
  identifier: string;
  intervention?: ToolIntervention;
  isArgumentsStreaming?: boolean;
  isToolCalling?: boolean;
  /**
   * ContentBlock ID (not the group message ID)
   */
  messageId: string;
  result?: ChatToolResult;
  showCustomToolRender?: boolean;
  toolCallId: string;
  toolMessageId?: string;
  type?: string;
}

/**
 * Tool Render for Group Messages
 *
 * In group messages, tool results are already embedded in the payload,
 * so we don't need to query them from the store or handle streaming.
 */
const Render = memo<RenderProps>(
  ({
    toolCallId,
    messageId,
    arguments: requestArgs,
    disableEditing,
    identifier,
    apiName,
    result,
    type,
    intervention,
    toolMessageId,
    isArgumentsStreaming,
    isToolCalling,
    showCustomToolRender,
  }) => {
    // A question whose producer stopped waiting is no longer offered as a card
    // (`getPendingInterventions` drops it), so the inline row is the only place
    // left to say what happened — returning null here would leave a silent gap
    // where the tool call was.
    // Live: flips at the producer's deadline even when nothing else re-renders
    // this row, so the row speaks up the moment the card leaves the screen.
    const timedOut = useIsTimedOutUnanswered(intervention, result?.state);

    // Pending interventions are rendered in the bottom InterventionBar, not inline
    if (!timedOut && toolMessageId && intervention?.status === 'pending' && !disableEditing) {
      return null;
    }

    if (timedOut) {
      return <RejectedResponse timedOut apiName={apiName} />;
    }

    if (intervention?.status === 'rejected') {
      return (
        <RejectedResponse
          apiName={apiName}
          reason={intervention.rejectedReason}
          skipped={intervention.skipped}
        />
      );
    }

    if (intervention?.status === 'aborted') {
      return <AbortResponse />;
    }

    // Handle arguments streaming state
    if (isArgumentsStreaming || !result) {
      // Check if there's a custom streaming renderer for this tool
      const StreamingRenderer = getBuiltinStreaming(identifier, apiName);

      if (StreamingRenderer) {
        const args = safeParsePartialJSON(requestArgs);

        return (
          <StreamingRenderer
            apiName={apiName}
            args={args}
            identifier={identifier}
            messageId={messageId}
            toolCallId={toolCallId}
          />
        );
      }

      // No custom streaming renderer, return null
      return null;
    }

    const placeholder = (
      <LoadingPlaceholder
        loading
        apiName={apiName}
        identifier={identifier}
        messageId={messageId}
        requestArgs={requestArgs}
        toolCallId={toolCallId}
      />
    );

    if (isToolCalling) return placeholder;

    return (
      <Suspense fallback={placeholder}>
        <Flexbox gap={8}>
          <ToolRender
            content={result.content || ''}
            messageId={toolMessageId}
            pluginState={result.state}
            showCustomToolRender={result.error ? false : showCustomToolRender}
            toolCallId={toolCallId}
            plugin={{
              apiName,
              arguments: requestArgs || '',
              identifier,
              type: type as any,
            }}
          />
        </Flexbox>
      </Suspense>
    );
  },
);

Render.displayName = 'GroupToolRender';

export default Render;

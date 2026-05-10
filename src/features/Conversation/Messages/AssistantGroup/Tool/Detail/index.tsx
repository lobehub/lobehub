import { getBuiltinRender } from '@lobechat/builtin-tools/renders';
import { getBuiltinStreaming } from '@lobechat/builtin-tools/streamings';
import { type ChatToolResult, type ToolIntervention } from '@lobechat/types';
import { safeParsePartialJSON } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import { memo, Suspense } from 'react';

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
    // Pending interventions are rendered in the bottom InterventionBar, not inline
    if (toolMessageId && intervention?.status === 'pending' && !disableEditing) {
      return null;
    }

    if (intervention?.status === 'rejected') {
      return <RejectedResponse reason={intervention.rejectedReason} />;
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

    // Some tool calls need user input mid-flight (e.g. CC's AskUserQuestion
    // delivered through the local MCP server, LOBE-8725). The producer
    // stamps `pluginState.askUserQuestion.status = 'pending'` on the tool
    // message, but the wider framework intervention plumbing isn't engaged
    // (no `intervention` field on the tool payload). Reach the registered
    // custom render directly so the UI can collect the answer rather than
    // showing the loading placeholder for the whole timeout window.
    const askUserPending =
      isToolCalling &&
      identifier === 'claude-code' &&
      apiName === 'askUserQuestion' &&
      (result?.state as { askUserQuestion?: { status?: string } } | undefined)?.askUserQuestion
        ?.status === 'pending';
    if (askUserPending) {
      const InlineRender = getBuiltinRender(identifier, apiName);
      if (InlineRender) {
        return (
          <Suspense fallback={placeholder}>
            <Flexbox gap={8}>
              <InlineRender
                apiName={apiName}
                args={safeParsePartialJSON(requestArgs)}
                content={result?.content || ''}
                identifier={identifier}
                messageId={toolMessageId || messageId}
                pluginState={result?.state}
                toolCallId={toolCallId}
              />
            </Flexbox>
          </Suspense>
        );
      }
    }

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

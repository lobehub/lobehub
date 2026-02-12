import { type ChatToolResult, type ToolIntervention } from '@lobechat/types';
import { safeParsePartialJSON } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import { memo, Suspense } from 'react';

import { getBuiltinStreaming } from '@/tools/streamings';

import AbortResponse from './AbortResponse';
import ErrorResponse from './ErrorResponse';
import Intervention from './Intervention';
import ModeSelector from './Intervention/ModeSelector';
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
    if (toolMessageId && intervention?.status === 'pending' && !disableEditing) {
      return (
        <Intervention
          apiName={apiName}
          id={toolMessageId}
          identifier={identifier}
          requestArgs={requestArgs || ''}
          toolCallId={toolCallId}
        />
      );
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

    // Handle error state
    if (result.error) {
      return (
        <ErrorResponse
          {...result.error}
          id={messageId}
          plugin={
            type
              ? ({
                  apiName,
                  arguments: requestArgs || '',
                  identifier,
                  type,
                } as any)
              : undefined
          }
        />
      );
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
            showCustomToolRender={showCustomToolRender}
            toolCallId={toolCallId}
            plugin={{
              apiName,
              arguments: requestArgs || '',
              identifier,
              type: type as any,
            }}
          />
          {!disableEditing && (
            <div>
              <ModeSelector />
            </div>
          )}
        </Flexbox>
      </Suspense>
    );
  },
);

Render.displayName = 'GroupToolRender';

export default Render;

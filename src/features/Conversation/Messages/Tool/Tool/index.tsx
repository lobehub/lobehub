import { getBuiltinRender } from '@lobechat/builtin-tools/renders';
import { Flexbox } from '@lobehub/ui';
import { Accordion, Skeleton } from '@lobehub/ui/base-ui';
import { type CSSProperties } from 'react';
import { memo, useState } from 'react';

import Actions from '@/features/Conversation/Messages/AssistantGroup/Tool/Actions';
import dynamic from '@/libs/next/dynamic';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../../../store';
import Inspectors from '../../AssistantGroup/Tool/Inspector';

const Debug = dynamic(() => import('../../AssistantGroup/Tool/Debug'), {
  loading: () => <Skeleton height={300} width={'100%'} />,
  ssr: false,
});

const Detail = dynamic(() => import('../../AssistantGroup/Tool/Detail'), {
  loading: () => <Skeleton height={120} width={'100%'} />,
  ssr: false,
});

export interface InspectorProps {
  apiName: string;
  arguments?: string;
  disableEditing?: boolean;
  identifier: string;
  index: number;
  messageId: string;
  style?: CSSProperties;
  toolCallId: string;
  type?: string;
}

/**
 * Tool message component - adapts Tool message data to use AssistantGroup/Tool components
 */
const Tool = memo<InspectorProps>(
  ({
    arguments: requestArgs,
    apiName,
    disableEditing,
    messageId,
    toolCallId,
    index,
    identifier,
    type,
  }) => {
    const [showDebug, setShowDebug] = useState(false);
    const [showCustomToolRender, setShowCustomToolRender] = useState(true);
    const [expand, setExpand] = useState(true);

    // Fetch tool message from store
    const toolMessage = useConversationStore(dataSelectors.getDbMessageByToolCallId(toolCallId));

    // Check if tool is still loading
    const loading = useConversationStore(
      messageStateSelectors.isToolCallStreaming(messageId, index),
    );

    // Adapt tool message data to AssistantGroup/Tool format
    const result = toolMessage
      ? {
          content: toolMessage.content,
          contentLength: toolMessage.contentLength,
          error: toolMessage.error,
          id: toolCallId,
          state: toolMessage.pluginState,
        }
      : undefined;

    // Don't render if still loading and no message yet
    if (loading && !toolMessage) return null;

    const hasCustomRender = !!getBuiltinRender(identifier, apiName);

    return (
      <Accordion
        gap={8}
        indicatorPlacement="inline"
        styles={{ trigger: { paddingBlock: 4, paddingInline: 4 } }}
        value={expand ? ['tool'] : []}
        items={[
          {
            action: !disableEditing && (
              <Actions
                assistantMessageId={messageId}
                canToggleCustomToolRender={hasCustomRender}
                identifier={identifier}
                setShowCustomToolRender={setShowCustomToolRender}
                setShowDebug={setShowDebug}
                showCustomToolRender={showCustomToolRender}
                showDebug={showDebug}
              />
            ),
            children: (
              <Flexbox gap={8} paddingBlock={8}>
                {showDebug && !disableEditing && (
                  <Debug
                    apiName={apiName}
                    identifier={identifier}
                    requestArgs={requestArgs}
                    result={result}
                    toolCallId={toolCallId}
                    toolMessageId={toolMessage?.id}
                    type={type}
                  />
                )}
                <Detail
                  apiName={apiName}
                  arguments={requestArgs}
                  disableEditing={disableEditing}
                  identifier={identifier}
                  messageId={messageId}
                  result={result}
                  showCustomToolRender={showCustomToolRender}
                  toolCallId={toolCallId}
                  type={type}
                />
              </Flexbox>
            ),
            key: 'tool',
            title: (
              <Inspectors
                apiName={apiName}
                identifier={identifier}
                result={result}
                toolCallId={toolCallId}
              />
            ),
          },
        ]}
        onValueChange={(value) => setExpand(value.length > 0)}
      />
    );
  },
);

Tool.displayName = 'AssistantTool';

export default Tool;

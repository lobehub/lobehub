import { Accordion, AccordionItem, Flexbox, Skeleton } from '@lobehub/ui';
import { type CSSProperties } from 'react';
import { memo, useState } from 'react';

import Actions from '@/features/Conversation/Messages/AssistantGroup/Tool/Actions';
import dynamic from '@/libs/next/dynamic';
import { getBuiltinRender } from '@/tools/renders';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../../../store';
import Inspectors from '../../AssistantGroup/Tool/Inspector';

const Debug = dynamic(() => import('../../AssistantGroup/Tool/Debug'), {
  loading: () => <Skeleton.Block active height={300} width={'100%'} />,
  ssr: false,
});

const Detail = dynamic(() => import('../../AssistantGroup/Tool/Detail'), {
  loading: () => <Skeleton.Block active height={120} width={'100%'} />,
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
        expandedKeys={expand ? ['tool'] : []}
        gap={8}
        onExpandedChange={(keys) => setExpand(keys.length > 0)}
      >
        <AccordionItem
          itemKey={'tool'}
          paddingBlock={4}
          paddingInline={4}
          title={<Inspectors apiName={apiName} identifier={identifier} result={result} />}
          action={
            !disableEditing && (
              <Actions
                assistantMessageId={messageId}
                canToggleCustomToolRender={hasCustomRender}
                identifier={identifier}
                setShowCustomToolRender={setShowCustomToolRender}
                setShowDebug={setShowDebug}
                showCustomToolRender={showCustomToolRender}
                showDebug={showDebug}
              />
            )
          }
        >
          <Flexbox gap={8} paddingBlock={8}>
            {showDebug && !disableEditing && (
              <Debug
                apiName={apiName}
                identifier={identifier}
                requestArgs={requestArgs}
                result={result}
                toolCallId={toolCallId}
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
        </AccordionItem>
      </Accordion>
    );
  },
);

Tool.displayName = 'AssistantTool';

export default Tool;

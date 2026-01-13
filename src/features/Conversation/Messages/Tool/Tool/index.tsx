import { Accordion, AccordionItem, Flexbox, Skeleton } from '@lobehub/ui';
import dynamic from 'next/dynamic';
import { type CSSProperties, memo, useState } from 'react';

import Actions from '@/features/Conversation/Messages/AssistantGroup/Tool/Actions';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../../../store';
import Inspectors from '../../AssistantGroup/Tool/Inspector';

const Debug = dynamic(() => import('../../AssistantGroup/Tool/Debug'), {
  loading: () => <Skeleton.Block active height={300} width={'100%'} />,
  ssr: false,
});

const Render = dynamic(() => import('../../AssistantGroup/Tool/Render'), {
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
  ({ arguments: requestArgs, apiName, disableEditing, messageId, toolCallId, index, identifier, type }) => {
    const [showDebug, setShowDebug] = useState(false);
    const [showPluginRender, setShowPluginRender] = useState(false);
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

    return (
      <Accordion
        expandedKeys={expand ? ['tool'] : []}
        gap={8}
        onExpandedChange={(keys) => setExpand(keys.length > 0)}
      >
        <AccordionItem
          action={
            !disableEditing && (
              <Actions
                assistantMessageId={messageId}
                handleExpand={(expand) => setExpand(!!expand)}
                identifier={identifier}
                setShowDebug={setShowDebug}
                setShowPluginRender={setShowPluginRender}
                showCustomPluginRender={false}
                showDebug={showDebug}
                showPluginRender={showPluginRender}
              />
            )
          }
          itemKey={'tool'}
          paddingBlock={4}
          paddingInline={4}
          title={<Inspectors apiName={apiName} identifier={identifier} result={result} />}
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
            <Render
              apiName={apiName}
              arguments={requestArgs}
              disableEditing={disableEditing}
              identifier={identifier}
              messageId={messageId}
              result={result}
              setShowPluginRender={setShowPluginRender}
              showPluginRender={showPluginRender}
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

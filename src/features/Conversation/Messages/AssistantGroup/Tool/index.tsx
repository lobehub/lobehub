import { type ChatToolResult, type ToolIntervention } from '@lobechat/types';
import { AccordionItem, Flexbox, Skeleton } from '@lobehub/ui';
import { Divider } from 'antd';
import dynamic from 'next/dynamic';
import { memo, useEffect, useState } from 'react';

import Actions from '@/features/Conversation/Messages/AssistantGroup/Tool/Actions';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { getBuiltinRender } from '@/tools/renders';
import { getBuiltinStreaming } from '@/tools/streamings';

import Inspectors from './Inspector';

const Debug = dynamic(() => import('./Debug'), {
  loading: () => <Skeleton.Block active height={300} width={'100%'} />,
  ssr: false,
});

const Render = dynamic(() => import('./Render'), {
  loading: () => <Skeleton.Block active height={120} width={'100%'} />,
  ssr: false,
});

export interface GroupToolProps {
  apiName: string;
  arguments?: string;
  assistantMessageId: string;
  expand?: boolean;
  handleExpand?: (expand?: boolean) => void;
  id: string;
  identifier: string;
  intervention?: ToolIntervention;
  /**
   * Callback to register whether this tool can be collapsed
   * Used by parent Accordion to prevent collapsing when alwaysExpand is set
   */
  onCollapsibleChange?: (canCollapse: boolean) => void;
  result?: ChatToolResult;
  toolMessageId?: string;
  type?: string;
}

const Tool = memo<GroupToolProps>(
  ({
    arguments: requestArgs,
    apiName,
    assistantMessageId,
    id,
    intervention,
    identifier,
    onCollapsibleChange,
    result,
    type,
    toolMessageId,
    handleExpand,
  }) => {
    // Get renderDisplayControl from manifest
    const renderDisplayControl = useToolStore(
      toolSelectors.getRenderDisplayControl(identifier, apiName),
    );
    const [showDebug, setShowDebug] = useState(false);
    const [showPluginRender, setShowPluginRender] = useState(false);

    const isPending = intervention?.status === 'pending';
    const isReject = intervention?.status === 'rejected';
    const isAbort = intervention?.status === 'aborted';
    const needExpand = renderDisplayControl !== 'collapsed' || isPending;
    const isAlwaysExpand = renderDisplayControl === 'alwaysExpand';

    const showCustomPluginRender = !isPending && !isReject && !isAbort;

    let isArgumentsStreaming = false;
    try {
      JSON.parse(requestArgs || '{}');
    } catch {
      isArgumentsStreaming = true;
    }

    const hasStreamingRenderer = !!getBuiltinStreaming(identifier, apiName);
    const forceShowStreamingRender = isArgumentsStreaming && hasStreamingRenderer;

    // Check if tool has custom render - if not, disable expand
    // Custom render exists when: builtin render exists OR plugin type is not 'default'
    const hasCustomRender = !!getBuiltinRender(identifier, apiName) || (!!type && type !== 'default');

    // Wrap handleExpand to prevent collapsing when alwaysExpand is set
    const wrappedHandleExpand = (expand?: boolean) => {
      // Block collapse action when alwaysExpand is set
      if (isAlwaysExpand && expand === false) {
        return;
      }
      handleExpand?.(expand);
    };

    useEffect(() => {
      if (needExpand) {
        setTimeout(() => wrappedHandleExpand(true), 100);
      }
    }, [needExpand]);

    // Notify parent about collapsibility
    useEffect(() => {
      onCollapsibleChange?.(!isAlwaysExpand);
    }, [isAlwaysExpand, onCollapsibleChange]);

    useEffect(() => {
      handleExpand?.(forceShowStreamingRender);
    }, [forceShowStreamingRender]);

    return (
      <AccordionItem
        action={
          <Actions
            assistantMessageId={assistantMessageId}
            handleExpand={wrappedHandleExpand}
            identifier={identifier}
            setShowDebug={setShowDebug}
            setShowPluginRender={setShowPluginRender}
            showCustomPluginRender={showCustomPluginRender}
            showDebug={showDebug}
            showPluginRender={showPluginRender}
          />
        }
        allowExpand={hasCustomRender}
        itemKey={id}
        paddingBlock={4}
        paddingInline={4}
        title={
          <Inspectors
            apiName={apiName}
            arguments={requestArgs}
            identifier={identifier}
            intervention={intervention}
            isArgumentsStreaming={isArgumentsStreaming}
            result={result}
          />
        }
      >
        <Flexbox gap={8} paddingBlock={8}>
          {showDebug && (
            <Debug
              apiName={apiName}
              identifier={identifier}
              intervention={intervention}
              requestArgs={requestArgs}
              result={result}
              toolCallId={id}
              type={type}
            />
          )}
          <Render
            apiName={apiName}
            arguments={requestArgs}
            identifier={identifier}
            intervention={intervention}
            isArgumentsStreaming={isArgumentsStreaming}
            messageId={assistantMessageId}
            result={result}
            setShowPluginRender={setShowPluginRender}
            showPluginRender={showPluginRender}
            toolCallId={id}
            toolMessageId={toolMessageId}
            type={type}
          />
          <Divider dashed style={{ marginBottom: 0, marginTop: 8 }} />
        </Flexbox>
      </AccordionItem>
    );
  },
);

Tool.displayName = 'GroupTool';

export default Tool;

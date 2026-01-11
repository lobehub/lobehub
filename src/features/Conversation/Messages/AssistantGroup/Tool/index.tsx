import { LOADING_FLAT } from '@lobechat/const';
import { type ChatToolResult, type ToolIntervention } from '@lobechat/types';
import { AccordionItem, Flexbox, Skeleton } from '@lobehub/ui';
import { Divider } from 'antd';
import dynamic from 'next/dynamic';
import { memo, useEffect, useState } from 'react';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { getBuiltinRender } from '@/tools/renders';
import { getBuiltinStreaming } from '@/tools/streamings';

import { ToolErrorBoundary } from '../../Tool/ErrorBoundary';
import Actions from './Actions';
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
  id: string;
  identifier: string;
  intervention?: ToolIntervention;
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
    result,
    type,
    toolMessageId,
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

    // Get precise tool calling state from operation
    const isToolCallingFromOperation = useChatStore(
      operationSelectors.isMessageInToolCalling(assistantMessageId),
    );

    // Fallback: arguments completed but no final result yet
    const isToolCallingFallback =
      !isArgumentsStreaming && (!result || result.content === LOADING_FLAT || !result.content);
    const isToolCalling = isToolCallingFromOperation || isToolCallingFallback;

    const hasCustomRender = !!getBuiltinRender(identifier, apiName);

    // Handle expand state changes with showPluginRender
    const handleExpand = (expand?: boolean) => {
      // Block collapse action when alwaysExpand is set
      if (isAlwaysExpand && expand === false) {
        return;
      }
      setShowPluginRender(!!expand);
    };

    useEffect(() => {
      if (needExpand) {
        setTimeout(() => handleExpand(true), 100);
      }
    }, [needExpand]);

    const isToolRenderExpand = forceShowStreamingRender || showPluginRender;
    return (
      <AccordionItem
        action={
          <Actions
            assistantMessageId={assistantMessageId}
            handleExpand={handleExpand}
            identifier={identifier}
            setShowDebug={setShowDebug}
            setShowPluginRender={setShowPluginRender}
            showCustomPluginRender={showCustomPluginRender}
            showDebug={showDebug}
            showPluginRender={showPluginRender}
          />
        }
        allowExpand={hasCustomRender}
        expand={isToolRenderExpand}
        itemKey={id}
        onExpandChange={setShowPluginRender}
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
          <ToolErrorBoundary apiName={apiName} identifier={identifier}>
            <Render
              apiName={apiName}
              arguments={requestArgs}
              identifier={identifier}
              intervention={intervention}
              isArgumentsStreaming={isArgumentsStreaming}
              isToolCalling={isToolCalling}
              messageId={assistantMessageId}
              result={result}
              setShowPluginRender={setShowPluginRender}
              showPluginRender={showPluginRender}
              toolCallId={id}
              toolMessageId={toolMessageId}
              type={type}
            />
          </ToolErrorBoundary>
          <Divider dashed style={{ marginBottom: 0, marginTop: 8 }} />
        </Flexbox>
      </AccordionItem>
    );
  },
);

Tool.displayName = 'GroupTool';

export default Tool;

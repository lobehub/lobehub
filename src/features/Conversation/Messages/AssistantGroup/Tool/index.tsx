import { getBuiltinRender } from '@lobechat/builtin-tools/renders';
import { getBuiltinStreaming } from '@lobechat/builtin-tools/streamings';
import { LOADING_FLAT } from '@lobechat/const';
import { type ChatToolResult, type ToolIntervention } from '@lobechat/types';
import { AccordionItem, Flexbox, Skeleton } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo, useEffect, useState } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';
import dynamic from '@/libs/next/dynamic';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

import Actions from './Actions';
import Inspectors from './Inspector';

const Debug = dynamic(() => import('./Debug'), {
  loading: () => <Skeleton.Block active height={300} width={'100%'} />,
  ssr: false,
});

const Detail = dynamic(() => import('./Detail'), {
  loading: () => <Skeleton.Block active height={120} width={'100%'} />,
  ssr: false,
});

export interface GroupToolProps {
  apiName: string;
  arguments?: string;
  assistantMessageId: string;
  disableEditing?: boolean;
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
    disableEditing,
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
    const [showToolRender, setShowToolRender] = useState(false);
    // Controls switching between custom render and fallback ArgumentRender
    const [showCustomToolRender, setShowCustomToolRender] = useState(true);

    const isPending = intervention?.status === 'pending';
    const isReject = intervention?.status === 'rejected';
    const isAbort = intervention?.status === 'aborted';
    const needExpand = renderDisplayControl !== 'collapsed' || isPending;
    const isAlwaysExpand = renderDisplayControl === 'alwaysExpand';

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

    // Only treat "missing/placeholder result" as in-flight while this assistant
    // message still has a running operation. After the run ends, tools may
    // legitimately have no merged `result` — do not keep showing "executing".
    const isAssistantMessageBusy = useChatStore(
      operationSelectors.isMessageProcessing(assistantMessageId),
    );

    const hasError = !!result?.error;
    // This tool's own result is the source of truth for completion. The
    // message-level toolCalling flag stays true while sibling tools are still
    // running, so without this guard a finished tool flips back into "loading".
    const hasFinishedResult =
      hasError || (!!result && result.content !== LOADING_FLAT && !!result.content);
    const looksLikeWaitingForToolResult = !hasError && !isArgumentsStreaming && !hasFinishedResult;
    const isToolCallingFallback = looksLikeWaitingForToolResult && isAssistantMessageBusy;
    const isToolCalling =
      !hasFinishedResult && (isToolCallingFromOperation || isToolCallingFallback);

    const hasCustomRender = !!getBuiltinRender(identifier, apiName);
    // Only allow toggle when has custom render and not in pending/reject/abort state
    const canToggleCustomToolRender = hasCustomRender && !isPending && !isReject && !isAbort;

    // Handle expand state changes
    const handleExpand = (expand?: boolean) => {
      // Block collapse action when alwaysExpand is set
      if (isAlwaysExpand && expand === false) {
        return;
      }
      // When collapsing, also turn off debug mode so the accordion can actually collapse
      if (expand === false) {
        setShowDebug(false);
      }
      setShowToolRender(!!expand);
    };

    useEffect(() => {
      if (needExpand) {
        setTimeout(() => handleExpand(true), 100);
      }
    }, [needExpand]);

    const isToolDetailExpand = forceShowStreamingRender || showToolRender || showDebug;

    return (
      <AccordionItem
        expand={isToolDetailExpand}
        hideIndicator={isAlwaysExpand}
        itemKey={id}
        paddingBlock={4}
        paddingInline={4}
        action={
          !disableEditing && (
            <Actions
              assistantMessageId={assistantMessageId}
              canToggleCustomToolRender={canToggleCustomToolRender}
              identifier={identifier}
              setShowCustomToolRender={setShowCustomToolRender}
              setShowDebug={setShowDebug}
              showCustomToolRender={showCustomToolRender}
              showDebug={showDebug}
            />
          )
        }
        title={
          <Inspectors
            apiName={apiName}
            arguments={requestArgs}
            identifier={identifier}
            intervention={intervention}
            isArgumentsStreaming={isArgumentsStreaming}
            isToolCalling={isToolCalling}
            result={result}
          />
        }
        onExpandChange={handleExpand}
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
          <SafeBoundary alertTitle={`${identifier} / ${apiName}`} variant="alert">
            <Detail
              apiName={apiName}
              arguments={requestArgs}
              disableEditing={disableEditing}
              identifier={identifier}
              intervention={intervention}
              isArgumentsStreaming={isArgumentsStreaming}
              isToolCalling={isToolCalling}
              messageId={assistantMessageId}
              result={result}
              showCustomToolRender={showCustomToolRender}
              toolCallId={id}
              toolMessageId={toolMessageId}
              type={type}
            />
          </SafeBoundary>
          <Divider dashed style={{ marginBottom: 0, marginTop: 8 }} />
        </Flexbox>
      </AccordionItem>
    );
  },
);

Tool.displayName = 'GroupTool';

export default Tool;

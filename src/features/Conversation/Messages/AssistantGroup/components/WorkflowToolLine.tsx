import { getBuiltinRender } from '@lobechat/builtin-tools/renders';
import { getBuiltinStreaming } from '@lobechat/builtin-tools/streamings';
import { LOADING_FLAT } from '@lobechat/const';
import { type ChatToolPayloadWithResult } from '@lobechat/types';
import { AccordionItem, Flexbox, Skeleton } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo, useCallback, useEffect, useState } from 'react';

import dynamic from '@/libs/next/dynamic';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

import { ToolErrorBoundary } from '../../Tool/ErrorBoundary';
import Actions from '../Tool/Actions';
import Detail from '../Tool/Detail';
import Inspectors from '../Tool/Inspector';

const Debug = dynamic(() => import('../Tool/Debug'), {
  loading: () => <Skeleton.Block active height={300} width={'100%'} />,
  ssr: false,
});

interface WorkflowToolLineProps {
  assistantMessageId: string;
  disableEditing?: boolean;
  tool: ChatToolPayloadWithResult;
}

const WorkflowToolLine = memo<WorkflowToolLineProps>(
  ({ tool, assistantMessageId, disableEditing }) => {
    const {
      apiName,
      arguments: requestArgs,
      id,
      identifier,
      intervention,
      result,
      result_msg_id: toolMessageId,
      type,
    } = tool;

    const renderDisplayControl = useToolStore(
      toolSelectors.getRenderDisplayControl(identifier, apiName),
    );
    const [showDebug, setShowDebug] = useState(false);
    const [showToolRender, setShowToolRender] = useState(false);
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

    const isToolCallingFromOperation = useChatStore(
      operationSelectors.isMessageInToolCalling(assistantMessageId),
    );

    const hasError = !!result?.error;
    const isToolCallingFallback =
      !hasError &&
      !isArgumentsStreaming &&
      (!result || result.content === LOADING_FLAT || !result.content);
    const isToolCalling = isToolCallingFromOperation || isToolCallingFallback;

    const hasCustomRender = !!getBuiltinRender(identifier, apiName);
    const canToggleCustomToolRender = hasCustomRender && !isPending && !isReject && !isAbort;

    const handleExpand = useCallback(
      (expand?: boolean) => {
        if (isAlwaysExpand && expand === false) {
          return;
        }
        if (expand === false) {
          setShowDebug(false);
        }
        setShowToolRender(!!expand);
      },
      [isAlwaysExpand],
    );

    useEffect(() => {
      if (!needExpand) return;
      const timer = window.setTimeout(() => {
        handleExpand(true);
      }, 100);
      return () => window.clearTimeout(timer);
    }, [handleExpand, needExpand]);

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
              toolRemoval={{ messageId: assistantMessageId, toolCallId: id }}
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
          <ToolErrorBoundary apiName={apiName} identifier={identifier}>
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
          </ToolErrorBoundary>
          <Divider dashed style={{ marginBottom: 0, marginTop: 8 }} />
        </Flexbox>
      </AccordionItem>
    );
  },
);

WorkflowToolLine.displayName = 'WorkflowToolLine';

export default WorkflowToolLine;

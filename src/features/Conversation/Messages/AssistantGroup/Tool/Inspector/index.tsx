import type { ActivateToolsState } from '@lobechat/builtin-tool-activator';
import { ActivatorApiName, LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import { getBuiltinInspector } from '@lobechat/builtin-tools/inspectors';
import type { ToolIntervention } from '@lobechat/types';
import { safeParseJSON, safeParsePartialJSON } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SafeBoundary from '@/components/ErrorBoundary';
import { LOADING_FLAT } from '@/const/message';

import ExecutionTime from './ExecutionTime';
import StatusIndicator from './StatusIndicator';
import ToolTitle from './ToolTitle';

interface InspectorProps {
  apiName: string;
  arguments?: string;
  identifier: string;
  intervention?: ToolIntervention;
  /**
   * Whether the tool arguments are currently streaming
   */
  isArgumentsStreaming?: boolean;
  result?: { content: string | null; error?: any; state?: any };
}

const Inspectors = memo<InspectorProps>(
  ({ identifier, apiName, arguments: argsStr, result, intervention, isArgumentsStreaming }) => {
    const hasError = !!result?.error;
    const hasSuccessResult = !!result?.content && result.content !== LOADING_FLAT;
    const hasResult = hasSuccessResult || hasError;

    const isPending = intervention?.status === 'pending';
    const isAborted = intervention?.status === 'aborted';
    const isRejected = intervention?.status === 'rejected';

    // Distinguish between arguments streaming and tool executing
    const isToolExecuting =
      !hasResult && !isPending && !isAborted && !isRejected && !isArgumentsStreaming;
    const isTitleLoading = isArgumentsStreaming || isToolExecuting;

    const activateToolsState = result?.state as ActivateToolsState | undefined;
    let statusSuccessVariant: 'warning' | undefined;
    if (
      identifier === LobeActivatorIdentifier &&
      apiName === ActivatorApiName.activateTools &&
      !isTitleLoading &&
      !result?.error
    ) {
      const notFound = activateToolsState?.notFound;
      const activated = activateToolsState?.activatedTools;
      if (
        Array.isArray(notFound) &&
        notFound.length > 0 &&
        (!activated || activated.length === 0)
      ) {
        statusSuccessVariant = 'warning';
      }
    }

    // Check for custom inspector renderer
    const CustomInspector = getBuiltinInspector(identifier, apiName);

    if (CustomInspector) {
      const args = safeParseJSON(argsStr);
      const partialJson = safeParsePartialJSON(argsStr);
      return (
        <Flexbox allowShrink horizontal align={'center'} gap={6}>
          <StatusIndicator
            intervention={intervention}
            result={result}
            successVariant={statusSuccessVariant}
          />
          <SafeBoundary minHeight={22} resetKeys={[argsStr, result]}>
            <CustomInspector
              apiName={apiName}
              args={args || {}}
              identifier={identifier}
              isArgumentsStreaming={isArgumentsStreaming}
              isLoading={isTitleLoading}
              partialArgs={partialJson}
              pluginState={result?.state}
              result={result}
            />
          </SafeBoundary>
          <ExecutionTime isExecuting={isToolExecuting} />
        </Flexbox>
      );
    }

    const args = safeParseJSON(argsStr);
    const partialJson = safeParsePartialJSON(argsStr);

    return (
      <Flexbox horizontal align={'center'} gap={6}>
        <StatusIndicator
          intervention={intervention}
          result={result}
          successVariant={statusSuccessVariant}
        />
        <ToolTitle
          apiName={apiName}
          args={args || undefined}
          identifier={identifier}
          isAborted={isAborted}
          isLoading={isTitleLoading}
          partialArgs={partialJson || undefined}
        />
        <ExecutionTime isExecuting={isToolExecuting} />
      </Flexbox>
    );
  },
);

export default Inspectors;

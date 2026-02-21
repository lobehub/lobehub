import { type ToolIntervention } from '@lobechat/types';
import { safeParseJSON, safeParsePartialJSON } from '@lobechat/utils';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { LOADING_FLAT } from '@/const/message';
import { getBuiltinInspector } from '@/tools/inspectors';

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

    // Distinguish between arguments streaming and tool executing
    const isToolExecuting = !hasResult && !isPending && !isAborted && !isArgumentsStreaming;
    const isTitleLoading = isArgumentsStreaming || isToolExecuting;

    // Check for custom inspector renderer
    const CustomInspector = getBuiltinInspector(identifier, apiName);

    if (CustomInspector) {
      const args = safeParseJSON(argsStr);
      const partialJson = safeParsePartialJSON(argsStr);
      return (
        <Flexbox allowShrink horizontal align={'center'} gap={6}>
          <StatusIndicator intervention={intervention} result={result} />
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
        </Flexbox>
      );
    }

    const args = safeParseJSON(argsStr);
    const partialJson = safeParsePartialJSON(argsStr);

    return (
      <Flexbox horizontal align={'center'} gap={6}>
        <StatusIndicator intervention={intervention} result={result} />
        <ToolTitle
          apiName={apiName}
          args={args || undefined}
          identifier={identifier}
          isAborted={isAborted}
          isLoading={isTitleLoading}
          partialArgs={partialJson || undefined}
        />
      </Flexbox>
    );
  },
);

export default Inspectors;

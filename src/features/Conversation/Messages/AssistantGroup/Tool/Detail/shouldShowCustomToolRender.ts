import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import type { ChatToolResult } from '@lobechat/types';

interface CustomToolRenderInput {
  apiName: string;
  identifier: string;
  result: Pick<ChatToolResult, 'error' | 'state'>;
  showCustomToolRender?: boolean;
}

/** Preserve the child-thread entry in a failed sub-agent tool result. */
export const shouldShowCustomToolRender = ({
  apiName,
  identifier,
  result,
  showCustomToolRender,
}: CustomToolRenderInput): boolean => {
  if (!showCustomToolRender) return false;
  if (!result.error) return true;

  return (
    identifier === LobeAgentIdentifier &&
    apiName === LobeAgentApiName.callSubAgent &&
    typeof result.state?.threadId === 'string'
  );
};

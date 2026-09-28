import { isCallSubAgentCall } from '@lobechat/builtin-tool-lobe-agent';
import type { ChatToolResult } from '@lobechat/types';

interface CustomToolRenderInput {
  apiName: string;
  identifier: string;
  result: Pick<ChatToolResult, 'error' | 'state'>;
  showCustomToolRender?: boolean;
}

/**
 * A failed `callSubAgent` whose child thread was preserved keeps its custom
 * render: that card is the only entry to the sub-agent's work.
 */
const isFailedSubAgentWithThread = ({
  apiName,
  identifier,
  result,
}: Omit<CustomToolRenderInput, 'showCustomToolRender'>): boolean =>
  isCallSubAgentCall({ apiName, identifier }) && typeof result.state?.threadId === 'string';

/**
 * Errored results fall back to the generic error view, except
 * {@link isFailedSubAgentWithThread}.
 */
export const shouldShowCustomToolRender = ({
  apiName,
  identifier,
  result,
  showCustomToolRender,
}: CustomToolRenderInput): boolean => {
  if (!showCustomToolRender) return false;
  if (!result.error) return true;

  return isFailedSubAgentWithThread({ apiName, identifier, result });
};

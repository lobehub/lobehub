import { formatContextSelections, formatPageSelections } from '@lobechat/prompts';
import type { ContextSelection, PageSelection } from '@lobechat/types';

/** System context a locally spawned CLI receives with the prompt. */
export const buildLocalHeterogeneousSystemContext = ({
  agentSystemContext,
  contextSelections,
  pageSelections,
  previousConversation,
}: {
  agentSystemContext?: string;
  contextSelections?: ContextSelection[];
  pageSelections?: PageSelection[];
  previousConversation?: string;
}): string | undefined => {
  const parts: string[] = [];

  if (agentSystemContext?.trim()) parts.push(agentSystemContext.trim());
  if (previousConversation) parts.push(previousConversation);

  const selectionContext =
    contextSelections && contextSelections.length > 0
      ? formatContextSelections(contextSelections)
      : pageSelections && pageSelections.length > 0
        ? formatPageSelections(pageSelections)
        : '';

  if (selectionContext) parts.push(selectionContext);

  return parts.length > 0 ? parts.join('\n\n') : undefined;
};

import { formatContextSelections, formatPageSelections } from '@lobechat/prompts';
import type { ContextSelection, PageSelection } from '@lobechat/types';

import {
  formatUncommittedChangesContext,
  type UncommittedChanges,
} from '@/helpers/uncommittedChanges';

/** {@link readLocalUncommittedChanges}, for the executor that builds this context. */
export { readLocalUncommittedChanges as readUncommitted } from './localUncommittedChanges';

/** System context a locally spawned CLI receives with the prompt. */
export const buildLocalHeterogeneousSystemContext = ({
  agentSystemContext,
  contextSelections,
  pageSelections,
  previousConversation,
  uncommittedChanges,
}: {
  agentSystemContext?: string;
  contextSelections?: ContextSelection[];
  pageSelections?: PageSelection[];
  previousConversation?: string;
  /** Someone's uncommitted work in the working directory (`readLocalUncommittedChanges`). */
  uncommittedChanges?: UncommittedChanges;
}): string | undefined => {
  const parts: string[] = [];

  if (agentSystemContext?.trim()) parts.push(agentSystemContext.trim());
  if (uncommittedChanges) parts.push(formatUncommittedChangesContext(uncommittedChanges));
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

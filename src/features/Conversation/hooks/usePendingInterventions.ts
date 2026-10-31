import type { PendingMcpElicitation } from '@/services/mcpElicitation';

import { dataSelectors, useConversationStore } from '../store';
import type { PendingIntervention } from '../store/slices/data/pendingInterventions';
import {
  isSamePendingInterventionList,
  mergePendingInterventions,
} from '../store/slices/data/pendingInterventions';
import { useUnexpiredInterventions } from './useDeadlineClock';
import { useFetchMcpElicitations } from './useFetchMcpElicitations';

/**
 * The conversation's unexpired pending approval / question cards.
 *
 * Custom equality: the selector builds a new list on every store change, and
 * without it any store update → new ref → re-render → Intervention's store
 * writes → loop. The deadline filter drops a card the moment its producer stops
 * waiting, even when nothing in the store moves.
 *
 * Kept out of `PendingInterventionBar` so non-UI consumers such as
 * `AssistantTurnSettledWatcher` do not pull in the whole intervention UI tree.
 */
export const usePendingInterventions = () => {
  const selected = useConversationStore(
    dataSelectors.pendingInterventions,
    isSamePendingInterventionList,
  );
  const { data } = useFetchMcpElicitations();
  const mcp =
    (data as PendingMcpElicitation[] | undefined)?.map((item): PendingIntervention => ({
      apiName: item.apiName,
      assistantGroupId: item.assistantMessageId,
      batchId: item.batchId,
      deadline: item.deadline,
      identifier: item.identifier,
      intervention: { batchId: item.batchId, operationId: item.operationId, status: 'pending' },
      mcpElicitation: item,
      operationId: item.operationId,
      requestArgs: '',
      toolCallId: item.toolCallId,
      toolMessageId: item.toolMessageId,
    })) ?? [];
  return useUnexpiredInterventions(mergePendingInterventions(selected, mcp));
};

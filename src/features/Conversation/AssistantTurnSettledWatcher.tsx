'use client';

import debug from 'debug';
import { useEffect, useMemo, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { type Operation, type OperationType } from '@/store/chat/slices/operation/types';

import {
  contextSelectors,
  conversationSelectors,
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
} from './store';

const log = debug('lobe-render:features:Conversation');

const assistantLikeRoles = new Set(['assistant', 'assistantGroup', 'supervisor']);

type SettlementReason = 'completed' | 'stopped' | 'regenerated' | 'continued';

// Restrict reason derivation to turn-level intents so child sub-ops (callLLM, executeToolCall, …) cannot shadow the parent type at settlement
const TURN_LEVEL_TYPES = new Set<OperationType>(['sendMessage', 'regenerate', 'continue']);

const deriveReason = (op: Operation): SettlementReason => {
  // cancelled wins over type: a stopped regenerate is still 'stopped'
  if (op.status === 'cancelled') return 'stopped';
  if (op.type === 'regenerate') return 'regenerated';
  if (op.type === 'continue') return 'continued';
  return 'completed';
};

const resolveReason = (messageId: string): SettlementReason => {
  const operations = operationSelectors.getOperationsByMessage(messageId)(useChatStore.getState());
  const terminal = operations
    .filter((op) => TURN_LEVEL_TYPES.has(op.type))
    .filter(
      (op) => op.status === 'completed' || op.status === 'cancelled' || op.status === 'failed',
    )
    .sort((a, b) => (b.metadata.endTime ?? 0) - (a.metadata.endTime ?? 0))[0];

  if (!terminal) {
    log('settlement fired without terminal op for messageId=%s', messageId);
    return 'completed';
  }

  return deriveReason(terminal);
};

const AssistantTurnSettledWatcher = () => {
  const displayMessages = useConversationStore(conversationSelectors.displayMessages);
  const onAssistantTurnSettled = useConversationStore(
    contextSelectors.hook('onAssistantTurnSettled'),
  );

  const latestAssistantMessageId = useMemo(() => {
    const latest = displayMessages.at(-1);
    if (!latest || !assistantLikeRoles.has(latest.role)) return undefined;
    return latest.id;
  }, [displayMessages]);

  const isLatestAssistantGenerating = useConversationStore((s) =>
    latestAssistantMessageId
      ? messageStateSelectors.isAssistantGroupItemGenerating(latestAssistantMessageId)(s)
      : false,
  );

  const pendingInterventionCount = useConversationStore(
    (s) => dataSelectors.pendingInterventions(s).length,
  );

  const armedSettledMessageIdRef = useRef<string>(undefined);
  const firedSettledMessageIdRef = useRef<string>(undefined);

  useEffect(() => {
    if (!onAssistantTurnSettled || !latestAssistantMessageId) return;

    if (pendingInterventionCount > 0) {
      armedSettledMessageIdRef.current = undefined;
      return;
    }

    if (isLatestAssistantGenerating) {
      armedSettledMessageIdRef.current = latestAssistantMessageId;
      return;
    }

    if (armedSettledMessageIdRef.current !== latestAssistantMessageId) return;
    if (firedSettledMessageIdRef.current === latestAssistantMessageId) return;

    firedSettledMessageIdRef.current = latestAssistantMessageId;
    armedSettledMessageIdRef.current = undefined;

    const reason = resolveReason(latestAssistantMessageId);
    void onAssistantTurnSettled(latestAssistantMessageId, { reason });
  }, [
    isLatestAssistantGenerating,
    latestAssistantMessageId,
    onAssistantTurnSettled,
    pendingInterventionCount,
  ]);

  return null;
};

export default AssistantTurnSettledWatcher;

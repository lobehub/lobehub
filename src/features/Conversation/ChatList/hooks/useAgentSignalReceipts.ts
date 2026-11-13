import type { UIChatMessage } from '@lobechat/types';
import { useMemo, useRef } from 'react';

import {
  agentSignalActions,
  type AgentSignalReceiptsParams,
  type AgentSignalReceiptView,
  agentSignalSelectors,
  useAgentSignalStore,
} from '@/store/agentSignal';

import { collectSteerChains } from '../../store/slices/data/steerChains';

export type { AgentSignalReceiptView } from '@/store/agentSignal';

/** Poll cadence for the active conversation's Agent Signal receipt surface. */
const AGENT_SIGNAL_RECEIPT_INITIAL_REFRESH_INTERVAL_MS = 3000;

/** Upper bound for one backoff sleep so the receipt surface still catches late async work. */
const AGENT_SIGNAL_RECEIPT_MAX_REFRESH_INTERVAL_MS = 60_000;

/** Maximum time to wait for async Agent Signal receipts in the current agent/topic scope. */
const AGENT_SIGNAL_RECEIPT_POLLING_TIMEOUT_MS = 5 * 60_000;

const EMPTY_RECEIPTS: AgentSignalReceiptView[] = [];

export const useAgentSignalReceipts = (input: {
  agentId?: string | null;
  displayMessages: UIChatMessage[];
  enabled?: boolean;
  pollingSignal?: string | null;
  topicId?: string | null;
}) => {
  // TODO: Migrate Agent Signal receipt visibility to a dedicated product capability flag.
  const shouldFetch = input.enabled === true && Boolean(input.agentId && input.topicId);
  const params = useMemo<AgentSignalReceiptsParams | null>(
    () => (shouldFetch ? { agentId: input.agentId!, topicId: input.topicId! } : null),
    [shouldFetch, input.agentId, input.topicId],
  );
  const scopeKey = params ? `${params.agentId}:${params.topicId}` : undefined;
  const pollingKey = scopeKey ? `${scopeKey}:${input.pollingSignal ?? ''}` : undefined;
  const scopeKeyRef = useRef<string | undefined>(undefined);
  const pollingKeyRef = useRef<string | undefined>(undefined);
  const pollingRef = useRef<{ params: AgentSignalReceiptsParams | null; startedAt?: number }>({
    params: null,
  });

  // Opening a topic (again) reconciles its whole head; polls stay incremental.
  if (scopeKeyRef.current !== scopeKey) {
    scopeKeyRef.current = scopeKey;
    if (params) agentSignalActions.requestFullReceiptHead(params);
  }

  if (pollingKeyRef.current !== pollingKey) {
    pollingKeyRef.current = pollingKey;
    pollingRef.current = { params, ...(params ? { startedAt: Date.now() } : {}) };
    if (params) agentSignalActions.resetReceiptPolling(params);
  }

  agentSignalActions.useFetchReceipts(params, {
    refreshInterval: () => {
      const { params: polled, startedAt } = pollingRef.current;
      if (!polled || startedAt === undefined) return 0;

      const elapsedMs = Date.now() - startedAt;
      const remainingMs = AGENT_SIGNAL_RECEIPT_POLLING_TIMEOUT_MS - elapsedMs;

      if (remainingMs <= 0) return 0;

      const emptyRefreshBackoffStep = Math.max(agentSignalActions.getEmptyRefreshes(polled) - 1, 0);
      const nextIntervalMs = Math.min(
        AGENT_SIGNAL_RECEIPT_INITIAL_REFRESH_INTERVAL_MS * 2 ** emptyRefreshBackoffStep,
        AGENT_SIGNAL_RECEIPT_MAX_REFRESH_INTERVAL_MS,
      );

      return Math.min(nextIntervalMs, remainingMs);
    },
  });

  const receipts = useAgentSignalStore(agentSignalSelectors.getReceipts(params)) ?? EMPTY_RECEIPTS;

  const receiptsByAnchor = useMemo(
    () =>
      groupAgentSignalReceiptsByEffectiveAnchor({
        displayMessages: input.displayMessages,
        receipts,
      }),
    [input.displayMessages, receipts],
  );

  return { receiptsByAnchor };
};

interface GroupAgentSignalReceiptsByEffectiveAnchorInput {
  displayMessages: UIChatMessage[];
  receipts: AgentSignalReceiptView[];
}

const resolveAssistantReplyFromTrigger = (
  triggerMessageId: string | undefined,
  displayMessages: UIChatMessage[],
) => {
  if (!triggerMessageId) return undefined;

  return displayMessages.find(
    (message) =>
      (message.role === 'assistant' || message.role === 'assistantGroup') &&
      message.parentId === triggerMessageId,
  )?.id;
};

const resolveDisplayedAnchorMessageId = (
  anchorMessageId: string,
  displayMessages: UIChatMessage[],
) => {
  const { hostOf } = collectSteerChains(displayMessages);

  if (displayMessages.some((message) => message.id === anchorMessageId)) {
    return hostOf.get(anchorMessageId) ?? anchorMessageId;
  }

  const assistantGroupId = displayMessages.find(
    (message) =>
      message.role === 'assistantGroup' &&
      message.children?.some((block) => block.id === anchorMessageId),
  )?.id;

  return assistantGroupId ? (hostOf.get(assistantGroupId) ?? assistantGroupId) : undefined;
};

const resolveEffectiveAnchorMessageId = (
  receipt: AgentSignalReceiptView,
  displayMessages: UIChatMessage[],
) => {
  if (receipt.anchorMessageId) {
    return resolveDisplayedAnchorMessageId(receipt.anchorMessageId, displayMessages);
  }
  if (!receipt.triggerMessageId) return undefined;

  const assistantReplyId = resolveAssistantReplyFromTrigger(
    receipt.triggerMessageId,
    displayMessages,
  );
  if (assistantReplyId) return resolveDisplayedAnchorMessageId(assistantReplyId, displayMessages);

  // Display fallback belongs here, not in the persisted receipt. A trigger-only
  // receipt tells us why the signal fired; the UI can attach it to the assistant
  // reply when that row exists, or keep it visible on the triggering user message
  // while the assistant row is still unavailable.
  return receipt.triggerMessageId;
};

const groupAgentSignalReceiptsByEffectiveAnchor = ({
  displayMessages,
  receipts,
}: GroupAgentSignalReceiptsByEffectiveAnchorInput) => {
  const receiptsByAnchor = new Map<string, AgentSignalReceiptView[]>();

  for (const receipt of receipts) {
    const anchorMessageId = resolveEffectiveAnchorMessageId(receipt, displayMessages);
    if (!anchorMessageId) continue;

    receiptsByAnchor.set(anchorMessageId, [
      ...(receiptsByAnchor.get(anchorMessageId) ?? []),
      receipt,
    ]);
  }

  return receiptsByAnchor;
};

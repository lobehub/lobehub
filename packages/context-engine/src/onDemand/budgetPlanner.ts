import type {
  OnDemandBudgetDecision,
  OnDemandBudgetDegradation,
  OnDemandBudgetDrop,
  OnDemandBudgetPlanInput,
  OnDemandDegradationReason,
  OnDemandDynamicEntry,
  OnDemandEntryDegradation,
  OnDemandFixedTokenBreakdown,
  OnDemandFixedTokenFloors,
  OnDemandTokenEstimator,
  OnDemandTokenEstimatorDescriptor,
} from '@lobechat/types';
import {
  compareOnDemandDynamicEntries,
  isOnDemandFloorValidForKind,
  isOnDemandHardFloorEntry,
  ON_DEMAND_DYNAMIC_KINDS,
} from '@lobechat/types';
import { estimateTokenCount } from 'tokenx';

import { OnDemandBudgetInputError } from './budgetErrors';
import { hashContent } from './canonical';
import {
  compactOnDemandSummary,
  renderOnDemandContextMessageContent,
  renderOnDemandSummaryContent,
} from './rendering';

export { OnDemandBudgetInputError } from './budgetErrors';

export const ON_DEMAND_TOKEN_ESTIMATOR_ID = 'tokenx';
export const ON_DEMAND_DEGRADE_RELEVANCE = 0.5;

const assertTokenCount = (value: number, field: string) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new OnDemandBudgetInputError(field, `${field} must be a finite non-negative number.`);
  }
};

const assertFixedTokens = (fixedTokens: OnDemandFixedTokenFloors) => {
  assertTokenCount(fixedTokens.userPrompt, 'fixedTokens.userPrompt');
  assertTokenCount(fixedTokens.currentUserMessage, 'fixedTokens.currentUserMessage');
  assertTokenCount(fixedTokens.protocol, 'fixedTokens.protocol');
  assertTokenCount(fixedTokens.bootstrapTools, 'fixedTokens.bootstrapTools');
  assertTokenCount(fixedTokens.activeToolContracts ?? 0, 'fixedTokens.activeToolContracts');
};

const assertEntry = (entry: OnDemandDynamicEntry, index: number) => {
  if (!entry.key) {
    throw new OnDemandBudgetInputError(`entries.${index}.key`, 'Entry key must not be empty.');
  }

  if (!Number.isFinite(entry.priority)) {
    throw new OnDemandBudgetInputError(
      `entries.${index}.priority`,
      'Entry priority must be finite.',
    );
  }

  if (!Number.isFinite(entry.relevance) || entry.relevance < 0 || entry.relevance > 1) {
    throw new OnDemandBudgetInputError(
      `entries.${index}.relevance`,
      'Entry relevance must be between 0 and 1.',
    );
  }

  assertTokenCount(entry.estimatedTokens, `entries.${index}.estimatedTokens`);

  if (!ON_DEMAND_DYNAMIC_KINDS.includes(entry.kind)) {
    throw new OnDemandBudgetInputError(
      `entries.${index}.kind`,
      `Unknown dynamic context kind: ${entry.kind}`,
    );
  }

  if (!entry.source?.id || !entry.source.type) {
    throw new OnDemandBudgetInputError(
      `entries.${index}.source`,
      'Entry source id and type must not be empty.',
    );
  }

  if (typeof entry.required !== 'boolean') {
    throw new OnDemandBudgetInputError(
      `entries.${index}.required`,
      'Entry required marker must be a boolean.',
    );
  }

  if (entry.floor && !isOnDemandFloorValidForKind(entry.kind, entry.floor)) {
    throw new OnDemandBudgetInputError(
      `entries.${index}.floor`,
      `Floor ${entry.floor} does not apply to kind ${entry.kind}.`,
    );
  }

  if (!entry.provenance.contentHash) {
    throw new OnDemandBudgetInputError(
      `entries.${index}.provenance.contentHash`,
      'Entry provenance hash must not be empty.',
    );
  }
};

const assertUniqueKeys = (entries: readonly OnDemandDynamicEntry[]) => {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      throw new OnDemandBudgetInputError('entries', `Duplicate entry key: ${entry.key}`);
    }

    seen.add(entry.key);
  }
};

const byteLength = (value: string): number => new TextEncoder().encode(value).length;

/**
 * The fallback is intentionally conservative: UTF-8 bytes are never fewer than
 * tokenx's estimate for arbitrary text, so an estimator failure cannot make a
 * protected floor appear cheaper than it is.
 */
export const estimateOnDemandTokensWithFallback = (
  content: string,
  estimator: OnDemandTokenEstimator,
): { failed: boolean; tokens: number } => {
  try {
    const tokens = estimator(content);
    assertTokenCount(tokens, 'estimator result');
    return { failed: false, tokens };
  } catch {
    return { failed: true, tokens: byteLength(content) };
  }
};

export const createOnDemandTokenEstimator =
  (_descriptor: OnDemandTokenEstimatorDescriptor): OnDemandTokenEstimator =>
  (content) =>
    estimateTokenCount(content);

const defaultEstimatorInfo: OnDemandTokenEstimatorDescriptor = Object.freeze({
  id: ON_DEMAND_TOKEN_ESTIMATOR_ID,
  model: 'unknown',
  provider: 'unknown',
});

export const getOnDemandRecoveryRef = (entry: OnDemandDynamicEntry): string =>
  entry.recoveryRef ??
  entry.provenance.referencePath ??
  `${entry.source.type}:${entry.source.id}#${entry.provenance.contentHash}`;

const createSummaryCard = (
  entry: OnDemandDynamicEntry,
  reason: OnDemandDegradationReason,
  estimatedTokens: number,
): OnDemandDynamicEntry => {
  const recoveryRef = getOnDemandRecoveryRef(entry);
  const summary =
    compactOnDemandSummary(entry.degradedContent?.trim() || entry.content) || entry.key;
  const content = renderOnDemandSummaryContent({ entry, reason, recoveryRef, summary });
  const degradedFrom: OnDemandEntryDegradation = Object.freeze({
    originalContentHash: entry.provenance.contentHash,
    originalEstimatedTokens: entry.estimatedTokens,
    reason,
    recoveryRef,
    strategy: 'summary_card',
  });

  return Object.freeze({
    ...entry,
    content,
    degradedFrom,
    estimatedTokens,
    recoveryRef,
  });
};

interface PreparedEntry {
  entry: OnDemandDynamicEntry;
  estimateFailed: boolean;
  tokens: number;
}

const prepareEntries = (
  entries: readonly OnDemandDynamicEntry[],
  estimator: OnDemandTokenEstimator,
  useEstimator: boolean,
): PreparedEntry[] =>
  entries.map((entry) => {
    if (!useEstimator) {
      return { entry, estimateFailed: false, tokens: entry.estimatedTokens };
    }

    const estimate = estimateOnDemandTokensWithFallback(
      renderOnDemandContextMessageContent(entry),
      estimator,
    );
    return { entry, estimateFailed: estimate.failed, tokens: estimate.tokens };
  });

const resolveFixedBreakdown = (
  fixedTokens: OnDemandFixedTokenFloors,
): OnDemandFixedTokenBreakdown => {
  const activeToolContracts = fixedTokens.activeToolContracts ?? 0;
  const total =
    fixedTokens.userPrompt +
    fixedTokens.currentUserMessage +
    fixedTokens.protocol +
    fixedTokens.bootstrapTools +
    activeToolContracts;

  return Object.freeze({
    activeToolContracts,
    bootstrapTools: fixedTokens.bootstrapTools,
    currentUserMessage: fixedTokens.currentUserMessage,
    protocol: fixedTokens.protocol,
    total,
    userPrompt: fixedTokens.userPrompt,
  });
};

/**
 * Plans a deterministic, non-mutating dynamic suffix.
 *
 * Protected entries (required, safety, pending action, or active tool contract)
 * are always retained. Optional entries are selected in the shared
 * priority/relevance order. When an optional entry does not fit, the planner
 * first tries a labelled summary card with provenance/recovery metadata; it
 * omits the entry only when even that card cannot fit.
 */
export const planOnDemandBudget = (input: OnDemandBudgetPlanInput): OnDemandBudgetDecision => {
  assertTokenCount(input.maxTokens, 'maxTokens');
  assertTokenCount(input.maxDynamicTokens ?? input.maxTokens, 'maxDynamicTokens');
  assertTokenCount(input.reserveTokens ?? 0, 'reserveTokens');
  assertFixedTokens(input.fixedTokens);
  input.entries.forEach(assertEntry);
  assertUniqueKeys(input.entries);

  const estimatorInfo = input.estimatorInfo ?? defaultEstimatorInfo;
  const estimator = input.estimator ?? createOnDemandTokenEstimator(estimatorInfo);
  const useEstimator = input.estimator !== undefined;
  const fixedBreakdown = resolveFixedBreakdown(input.fixedTokens);
  const fixedTokens = fixedBreakdown.total;
  const reserveTokens = Math.min(input.reserveTokens ?? 0, input.maxTokens);
  const maxDynamicTokens = Math.min(input.maxDynamicTokens ?? input.maxTokens, input.maxTokens);
  const nonReserveCapacity = Math.max(0, input.maxTokens - reserveTokens);
  const availableDynamicTokens = Math.min(
    maxDynamicTokens,
    Math.max(0, nonReserveCapacity - fixedTokens),
  );

  const sorted = prepareEntries(input.entries, estimator, useEstimator).sort((a, b) =>
    compareOnDemandDynamicEntries(a.entry, b.entry),
  );
  const protectedEntries = sorted.filter(
    ({ entry }) => isOnDemandHardFloorEntry(entry) || entry.required,
  );
  const optionalEntries = sorted.filter(
    ({ entry }) => !isOnDemandHardFloorEntry(entry) && !entry.required,
  );
  const hardFloorTokens = protectedEntries.reduce((sum, item) => sum + item.tokens, 0);
  const optionalCapacity = Math.max(0, availableDynamicTokens - hardFloorTokens);
  const optionalDemand = optionalEntries.reduce((sum, item) => sum + item.tokens, 0);
  const underPressure = optionalDemand > optionalCapacity;

  let remainingTokens = optionalCapacity;
  const selectedOptional: OnDemandDynamicEntry[] = [];
  const dropped: OnDemandBudgetDrop[] = [];
  const degraded: OnDemandBudgetDegradation[] = [];
  const selectedStatus = new Map<
    string,
    { estimatedTokens: number; originalEstimatedTokens?: number; status: 'degraded' | 'included' }
  >();
  const droppedStatus = new Map<string, OnDemandBudgetDrop['reason']>();
  const estimatorFailureKeys = new Set(
    sorted.filter((item) => item.estimateFailed).map((item) => item.entry.key),
  );

  for (const item of protectedEntries) {
    selectedStatus.set(item.entry.key, {
      estimatedTokens: item.tokens,
      status: 'included',
    });
  }

  for (const item of optionalEntries) {
    if (!item.entry.content.trim()) {
      dropped.push(Object.freeze({ entry: item.entry, reason: 'empty' }));
      droppedStatus.set(item.entry.key, 'empty');
      continue;
    }

    const shouldTrySummary =
      item.estimateFailed ||
      item.tokens > remainingTokens ||
      (underPressure && item.entry.relevance < ON_DEMAND_DEGRADE_RELEVANCE);

    if (!shouldTrySummary) {
      selectedOptional.push(item.entry);
      selectedStatus.set(item.entry.key, {
        estimatedTokens: item.tokens,
        status: 'included',
      });
      remainingTokens -= item.tokens;
      continue;
    }

    const reason: OnDemandDegradationReason = item.estimateFailed
      ? 'estimator_failed'
      : item.entry.relevance < ON_DEMAND_DEGRADE_RELEVANCE
        ? 'low_relevance'
        : 'budget_exceeded';
    const summaryEntry = createSummaryCard(item.entry, reason, 0);
    const summaryEstimate = estimateOnDemandTokensWithFallback(
      renderOnDemandContextMessageContent(summaryEntry),
      estimator,
    );

    if (summaryEstimate.failed) {
      estimatorFailureKeys.add(item.entry.key);
      dropped.push(Object.freeze({ entry: item.entry, reason: 'estimator_failed' }));
      droppedStatus.set(item.entry.key, 'estimator_failed');
      continue;
    }

    if (summaryEstimate.tokens < item.tokens && summaryEstimate.tokens <= remainingTokens) {
      const degradedEntry = createSummaryCard(item.entry, reason, summaryEstimate.tokens);
      selectedOptional.push(degradedEntry);
      selectedStatus.set(item.entry.key, {
        estimatedTokens: summaryEstimate.tokens,
        originalEstimatedTokens: item.tokens,
        status: 'degraded',
      });
      degraded.push(
        Object.freeze({
          degradedEntry,
          entry: item.entry,
          reason,
        }),
      );
      remainingTokens -= summaryEstimate.tokens;
      continue;
    }

    dropped.push(Object.freeze({ entry: item.entry, reason: 'budget_exceeded' }));
    droppedStatus.set(item.entry.key, 'budget_exceeded');
  }

  const selectedOptionalTokens = selectedOptional.reduce((sum, entry) => {
    const status = selectedStatus.get(entry.key);
    return sum + (status?.estimatedTokens ?? entry.estimatedTokens);
  }, 0);
  const selected = Object.freeze([
    ...protectedEntries.map((item) => item.entry),
    ...selectedOptional,
  ]);
  const decisions = sorted.map((item) => {
    const selectedEntry = selectedStatus.get(item.entry.key);
    if (selectedEntry) {
      return Object.freeze({
        estimatedTokens: selectedEntry.estimatedTokens,
        key: item.entry.key,
        kind: item.entry.kind,
        ...(selectedEntry.originalEstimatedTokens !== undefined && {
          originalEstimatedTokens: selectedEntry.originalEstimatedTokens,
        }),
        status: selectedEntry.status,
      });
    }

    const reason = droppedStatus.get(item.entry.key) ?? 'budget_exceeded';
    return Object.freeze({
      estimatedTokens: item.tokens,
      key: item.entry.key,
      kind: item.entry.kind,
      reason,
      status: 'omitted' as const,
    });
  });
  const reserveUsedTokens = Math.min(
    reserveTokens,
    Math.max(0, fixedTokens + hardFloorTokens - nonReserveCapacity),
  );
  const hardFloorOverflowTokens = Math.max(0, fixedTokens + hardFloorTokens - input.maxTokens);
  const decisionWithoutHash = {
    availableDynamicTokens,
    decisions: Object.freeze(decisions),
    degraded: Object.freeze(degraded),
    dropped: Object.freeze(dropped),
    estimator: Object.freeze(estimatorInfo),
    estimatorFailureCount: estimatorFailureKeys.size,
    fixedBreakdown,
    fixedTokens,
    hardFloorOverflowTokens,
    hardFloorTokens,
    maxDynamicTokens,
    maxTokens: input.maxTokens,
    reserveTokens,
    reserveUsedTokens,
    selected,
    selectedOptionalTokens,
    status: hardFloorOverflowTokens > 0 ? 'hard_floor_overflow' : 'within_budget',
    totalTokens: fixedTokens + hardFloorTokens + selectedOptionalTokens,
  } satisfies Omit<OnDemandBudgetDecision, 'hash'>;

  return Object.freeze({
    ...decisionWithoutHash,
    hash: hashContent(decisionWithoutHash),
  });
};

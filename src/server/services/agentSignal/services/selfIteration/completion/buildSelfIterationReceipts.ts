import type { AgentSignalOperationMarker } from '@/server/services/agentSignal/operationMarker';

import type { AgentSignalReceipt } from '../../receiptService';
import type { ToolResultWithKind } from '../finalStateExtractor';

/**
 * Maps a durable mutation tool's api name to the user-facing receipt domain.
 * Proposal lifecycle tools surface as `review`; skill / memory writes surface as
 * their resource domain. Any unmapped mutation is treated as a `review` outcome.
 */
const RECEIPT_KIND_BY_API: Record<string, AgentSignalReceipt['kind']> = {
  closeSelfReviewProposal: 'review',
  createSelfReviewProposal: 'review',
  createSkillIfAbsent: 'skill',
  refreshSelfReviewProposal: 'review',
  replaceSkillContentCAS: 'skill',
  supersedeSelfReviewProposal: 'review',
  writeMemory: 'memory',
};

/**
 * Default terminal status per api name, mirroring the legacy `createToolSet`
 * `successStatus` so receipts read the same on the execAgent path. A tool result
 * carrying an explicit `skipped_*` status overrides this to `skipped`.
 */
const SUCCESS_STATUS_BY_API: Record<string, AgentSignalReceipt['status']> = {
  closeSelfReviewProposal: 'applied',
  createSelfReviewProposal: 'proposed',
  createSkillIfAbsent: 'applied',
  refreshSelfReviewProposal: 'proposed',
  replaceSkillContentCAS: 'applied',
  supersedeSelfReviewProposal: 'applied',
  writeMemory: 'applied',
};

const DEFAULT_TITLE_BY_API: Record<string, string> = {
  closeSelfReviewProposal: 'Self-review proposal closed',
  createSelfReviewProposal: 'Self-review proposal created',
  createSkillIfAbsent: 'Skill created',
  refreshSelfReviewProposal: 'Self-review proposal refreshed',
  replaceSkillContentCAS: 'Skill updated',
  supersedeSelfReviewProposal: 'Self-review proposal superseded',
  writeMemory: 'Memory saved',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** A `skipped_unsupported` / `skipped_stale` tool status collapses to `skipped`. */
const isSkippedStatus = (status: unknown): boolean =>
  typeof status === 'string' && status.startsWith('skipped');

export interface BuildSelfIterationReceiptsInput {
  agentId: string;
  /** Non-actionable idea / intent recorder outputs (kind: artifact). */
  artifacts: ToolResultWithKind[];
  /** Receipt creation timestamp (ms). */
  createdAt: number;
  /** The run's agent-signal marker, read from the operation. */
  marker: AgentSignalOperationMarker;
  /** Durable write tool outputs (kind: mutation). */
  mutations: ToolResultWithKind[];
  operationId: string;
  sourceId: string;
  sourceType: string;
  topicId: string;
  userId: string;
}

const SUMMARY_TITLE_BY_KIND: Record<AgentSignalOperationMarker['kind'], string> = {
  'memory': 'Memory write completed',
  'nightly-review': 'Nightly self-review completed',
  'self-feedback-intent': 'Self-feedback intent completed',
  'self-reflection': 'Self-reflection completed',
};

/**
 * Projects the durable outcomes of a completed self-iteration run into
 * user-visible Agent Signal receipts, driven entirely by the run's finalState
 * (no side-channel accumulator). Produces one summary receipt per run plus one
 * action receipt per durable mutation. Receipt ids are deterministic
 * (`sourceId` + tool call id), so re-projecting the same run is idempotent — the
 * receipt store dedupes by id.
 *
 * Mirrors the legacy `createReceipts` mapping (kind / status / target) so
 * receipts read identically whether produced by the old runtime accumulator or
 * the execAgent completion path.
 */
export const buildSelfIterationReceipts = (
  input: BuildSelfIterationReceiptsInput,
): AgentSignalReceipt[] => {
  const {
    agentId,
    artifacts,
    createdAt,
    marker,
    mutations,
    operationId,
    sourceId,
    sourceType,
    topicId,
    userId,
  } = input;

  const base = {
    agentId,
    ...(marker.anchorMessageId ? { anchorMessageId: marker.anchorMessageId } : {}),
    createdAt,
    operationId,
    sourceId,
    sourceType,
    topicId,
    ...(marker.triggerMessageId ? { triggerMessageId: marker.triggerMessageId } : {}),
    userId,
  } satisfies Partial<AgentSignalReceipt>;

  const summary: AgentSignalReceipt = {
    ...base,
    detail: `Captured ${artifacts.length} idea(s) and applied ${mutations.length} write(s).`,
    id: `${sourceId}:self-iteration-summary`,
    kind: 'review',
    metadata: {
      actionCount: mutations.length,
      ...(marker.localDate ? { localDate: marker.localDate } : {}),
      sourceType,
    },
    status: 'completed',
    title: SUMMARY_TITLE_BY_KIND[marker.kind],
  };

  const actionReceipts = mutations.flatMap((mutation, index): AgentSignalReceipt[] => {
    const apiName = mutation.apiName;
    if (!apiName) return [];

    const data = isRecord(mutation.data) ? mutation.data : {};
    const kind = RECEIPT_KIND_BY_API[apiName] ?? 'review';
    const status = isSkippedStatus(data.status)
      ? 'skipped'
      : (SUCCESS_STATUS_BY_API[apiName] ?? 'applied');

    const summaryText = str(data.summary);
    const resourceId = str(data.resourceId);
    const title = summaryText ?? DEFAULT_TITLE_BY_API[apiName] ?? 'Agent Signal action';

    return [
      {
        ...base,
        detail: summaryText ?? title,
        // Deterministic + idempotent: same run re-projects to the same id.
        id: `${sourceId}:${mutation.toolCallId ?? `${apiName}:${index}`}:${kind}`,
        kind,
        metadata: {
          ...(marker.localDate ? { localDate: marker.localDate } : {}),
          sourceType,
        },
        status,
        // Proposal (`review`) outcomes have no openable resource target.
        ...(kind === 'review'
          ? {}
          : {
              target: {
                ...(resourceId ? { id: resourceId } : {}),
                ...(summaryText ? { summary: summaryText } : {}),
                title,
                type: kind,
              },
            }),
        title,
      },
    ];
  });

  return [summary, ...actionReceipts];
};

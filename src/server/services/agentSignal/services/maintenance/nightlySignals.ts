import type {
  DocumentActivityDigest,
  FeedbackActivityDigest,
  MaintenanceSignal,
  NightlyReviewTopicDigest,
  ReceiptActivityDigest,
  ToolActivityDigest,
} from './nightlyCollector';
import type { EvidenceRef } from './types';

interface DeriveNightlyMaintenanceSignalsInput {
  documentActivity: DocumentActivityDigest;
  feedbackActivity: FeedbackActivityDigest;
  receiptActivity: ReceiptActivityDigest;
  toolActivity: ToolActivityDigest[];
  topics?: NightlyReviewTopicDigest[];
}

const pushUniqueRef = (refs: EvidenceRef[], ref: EvidenceRef) => {
  if (refs.some((item) => item.type === ref.type && item.id === ref.id)) return;

  refs.push(ref);
};

const createFeedbackFeatures = (feedbackActivity: FeedbackActivityDigest) =>
  [...feedbackActivity.satisfied, ...feedbackActivity.notSatisfied].map((item) => ({
    confidence: item.confidence,
    reason: item.reason,
    result: item.result,
    type: 'feedback_satisfaction' as const,
  }));

/**
 * Derives conservative nightly maintenance signals from bounded context buckets.
 *
 * Use when:
 * - The nightly reviewer needs a small entry-point list before inspecting buckets
 * - Tests need deterministic maintenance signal behavior without DB or LLM calls
 *
 * Expects:
 * - Input buckets are already bounded, redacted, and review-window scoped
 *
 * Returns:
 * - Ordered maintenance signals where weak single-source evidence never authorizes mutation
 */
export const deriveNightlyMaintenanceSignals = (
  input: DeriveNightlyMaintenanceSignalsInput,
): MaintenanceSignal[] => {
  const signals: MaintenanceSignal[] = [];
  const feedbackFeatures = createFeedbackFeatures(input.feedbackActivity);

  for (const tool of input.toolActivity) {
    const topicCount = new Set(tool.topicIds).size;
    const toolFeature = {
      apiName: tool.apiName,
      failedCount: tool.failedCount,
      identifier: tool.identifier,
      topicCount,
      totalCount: tool.totalCount,
      type: 'tool_usage' as const,
    };

    if (tool.totalCount >= 3) {
      signals.push({
        evidenceRefs: tool.messageIds.slice(0, 5).map((id) => ({ id, type: 'message' })),
        features: [toolFeature, ...feedbackFeatures],
        kind: 'frequent_tool_workflow',
        strength: 'weak',
      });
    }

    if (tool.failedCount >= 2) {
      signals.push({
        evidenceRefs: tool.messageIds.slice(0, 5).map((id) => ({ id, type: 'message' })),
        features: [toolFeature, ...feedbackFeatures],
        kind: 'repeated_tool_failure',
        strength: feedbackFeatures.length > 0 ? 'strong' : 'medium',
      });
    }
  }

  if (input.documentActivity.skillBucket.length > 0) {
    const evidenceRefs: EvidenceRef[] = [];
    for (const item of input.documentActivity.skillBucket) {
      pushUniqueRef(evidenceRefs, { id: item.agentDocumentId, type: 'agent_document' });
    }

    signals.push({
      evidenceRefs,
      features: [
        {
          documentCount: input.documentActivity.skillBucket.length,
          eventCount: input.documentActivity.skillBucket.length,
          hintIsSkill: input.documentActivity.skillBucket.some((item) => item.hintIsSkill),
          type: 'document_hint',
        },
        ...feedbackFeatures,
      ],
      kind: 'hinted_skill_document_changed',
      strength: feedbackFeatures.length > 0 ? 'strong' : 'medium',
    });

    const failedToolSignals = input.toolActivity.filter((tool) => tool.failedCount > 0);
    if (failedToolSignals.length > 0) {
      for (const tool of failedToolSignals) {
        for (const id of tool.messageIds.slice(0, 3)) {
          pushUniqueRef(evidenceRefs, { id, type: 'message' });
        }
      }

      signals.push({
        evidenceRefs,
        features: [
          {
            documentCount: input.documentActivity.skillBucket.length,
            eventCount: input.documentActivity.skillBucket.length,
            hintIsSkill: input.documentActivity.skillBucket.some((item) => item.hintIsSkill),
            type: 'document_hint',
          },
          ...failedToolSignals.slice(0, 3).map((tool) => ({
            apiName: tool.apiName,
            failedCount: tool.failedCount,
            identifier: tool.identifier,
            topicCount: new Set(tool.topicIds).size,
            totalCount: tool.totalCount,
            type: 'tool_usage' as const,
          })),
          ...feedbackFeatures,
        ],
        kind: 'skill_document_with_tool_failure',
        strength: feedbackFeatures.length > 0 ? 'strong' : 'medium',
      });
    }
  }

  if (input.documentActivity.skillBucket.length >= 2) {
    signals.push({
      evidenceRefs: input.documentActivity.skillBucket
        .slice(0, 5)
        .map((item) => ({ id: item.agentDocumentId, type: 'agent_document' })),
      features: [
        {
          documentCount: input.documentActivity.skillBucket.length,
          eventCount: input.documentActivity.skillBucket.length,
          hintIsSkill: input.documentActivity.skillBucket.some((item) => item.hintIsSkill),
          type: 'document_hint',
        },
      ],
      kind: 'skill_documents_maybe_overlap',
      strength: 'medium',
    });
  }

  if (input.receiptActivity.pendingProposalCount > 0) {
    signals.push({
      evidenceRefs: input.receiptActivity.recentReceipts
        .slice(0, 5)
        .map((item) => ({ id: item.id, type: 'receipt' })),
      features: [
        {
          appliedCount: input.receiptActivity.appliedCount,
          dedupedCount: input.receiptActivity.duplicateGroups.length,
          failedCount: input.receiptActivity.failedCount,
          pendingProposalCount: input.receiptActivity.pendingProposalCount,
          type: 'receipt_history',
        },
      ],
      kind: 'pending_related_proposal_exists',
      strength: 'weak',
    });
  }

  return signals;
};

import { describe, expect, it } from 'vitest';

import type {
  DocumentActivityDigest,
  FeedbackActivityDigest,
  ReceiptActivityDigest,
} from '../nightlyCollector';
import { deriveNightlyMaintenanceSignals } from '../nightlySignals';

const createEmptyDocumentActivityForTest = (): DocumentActivityDigest => ({
  ambiguousBucket: [],
  excludedSummary: { count: 0, reasons: [] },
  generalDocumentBucket: [],
  skillBucket: [],
});

const createEmptyFeedbackActivityForTest = (): FeedbackActivityDigest => ({
  neutralCount: 0,
  notSatisfied: [],
  satisfied: [],
});

const createEmptyReceiptActivityForTest = (): ReceiptActivityDigest => ({
  appliedCount: 0,
  duplicateGroups: [],
  failedCount: 0,
  pendingProposalCount: 0,
  recentReceipts: [],
  reviewCount: 0,
});

describe('deriveNightlyMaintenanceSignals', () => {
  /**
   * @example
   * Tool activity by itself is telemetry only and should stay weak.
   */
  it('keeps frequent tool usage weak when there is no document feedback or receipt support', () => {
    expect(
      deriveNightlyMaintenanceSignals({
        documentActivity: createEmptyDocumentActivityForTest(),
        feedbackActivity: createEmptyFeedbackActivityForTest(),
        receiptActivity: createEmptyReceiptActivityForTest(),
        toolActivity: [
          {
            apiName: 'createDocument',
            failedCount: 0,
            identifier: 'lobe-agent-documents',
            messageIds: ['msg-1', 'msg-2', 'msg-3'],
            sampleArgs: [],
            sampleErrors: [],
            topicIds: ['topic-1', 'topic-2'],
            totalCount: 3,
          },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({
        kind: 'frequent_tool_workflow',
        strength: 'weak',
      }),
    );
  });

  /**
   * @example
   * Tool-only activity never becomes skill overlap evidence.
   */
  it('does not create skill overlap signals from tool usage alone', () => {
    const signals = deriveNightlyMaintenanceSignals({
      documentActivity: createEmptyDocumentActivityForTest(),
      feedbackActivity: createEmptyFeedbackActivityForTest(),
      receiptActivity: createEmptyReceiptActivityForTest(),
      toolActivity: [
        {
          apiName: 'createDocument',
          failedCount: 0,
          identifier: 'lobe-agent-documents',
          messageIds: ['msg-1', 'msg-2', 'msg-3'],
          sampleArgs: [],
          sampleErrors: [],
          topicIds: ['topic-1', 'topic-2'],
          totalCount: 3,
        },
      ],
    });

    expect(signals.map((signal) => signal.kind)).not.toContain('skill_documents_maybe_overlap');
  });

  /**
   * @example
   * Explicit hinted skill document activity should be a medium maintenance signal.
   */
  it('creates hinted skill document signals from hintIsSkill document activity', () => {
    expect(
      deriveNightlyMaintenanceSignals({
        documentActivity: {
          ambiguousBucket: [],
          excludedSummary: { count: 0, reasons: [] },
          generalDocumentBucket: [],
          skillBucket: [
            {
              agentDocumentId: 'agent-doc-1',
              documentId: 'doc-1',
              hintIsSkill: true,
              reason: 'metadata.agentSignal.hintIsSkill=true',
              title: 'Release workflow skill',
              updatedAt: '2026-05-09T18:10:00.000Z',
            },
          ],
        },
        feedbackActivity: createEmptyFeedbackActivityForTest(),
        receiptActivity: createEmptyReceiptActivityForTest(),
        toolActivity: [],
      }),
    ).toContainEqual(
      expect.objectContaining({
        evidenceRefs: [{ id: 'agent-doc-1', type: 'agent_document' }],
        kind: 'hinted_skill_document_changed',
        strength: 'medium',
      }),
    );
  });

  /**
   * @example
   * Repeated failed tool calls become a repair signal.
   */
  it('creates repeated tool failure signals when failure count crosses the threshold', () => {
    expect(
      deriveNightlyMaintenanceSignals({
        documentActivity: createEmptyDocumentActivityForTest(),
        feedbackActivity: createEmptyFeedbackActivityForTest(),
        receiptActivity: createEmptyReceiptActivityForTest(),
        toolActivity: [
          {
            apiName: 'validate',
            failedCount: 2,
            identifier: 'release-note',
            messageIds: ['msg-1', 'msg-2'],
            sampleArgs: [],
            sampleErrors: ['timeout'],
            topicIds: ['topic-1'],
            totalCount: 2,
          },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({
        kind: 'repeated_tool_failure',
        strength: 'medium',
      }),
    );
  });

  /**
   * @example
   * Ordinary message wording and correction metadata are not durable preference evidence.
   */
  it('does not create durable user preference signals from correction-bearing topics', () => {
    const signals = deriveNightlyMaintenanceSignals({
      documentActivity: createEmptyDocumentActivityForTest(),
      feedbackActivity: createEmptyFeedbackActivityForTest(),
      receiptActivity: createEmptyReceiptActivityForTest(),
      toolActivity: [],
      topics: [
        {
          correctionCount: 1,
          correctionIds: ['msg-preference'],
          evidenceRefs: [{ id: 'msg-preference', type: 'message' }],
          highSignalReasons: ['correction'],
          id: 'topic-preference',
          messageCount: 2,
          reviewScore: 3002,
          summary: 'User explicitly asked future summaries to be concise and conclusion-first.',
        },
      ],
    });

    expect(signals.map((signal) => signal.kind)).not.toContain('durable_user_preference');
  });

  /**
   * @example
   * Two skill bucket documents produce an overlap review signal.
   */
  it('creates possible skill overlap signals from multiple skill document events', () => {
    const signals = deriveNightlyMaintenanceSignals({
      documentActivity: {
        ambiguousBucket: [],
        excludedSummary: { count: 0, reasons: [] },
        generalDocumentBucket: [],
        skillBucket: [
          {
            agentDocumentId: 'agent-doc-1',
            documentId: 'doc-1',
            hintIsSkill: true,
            reason: 'metadata.agentSignal.hintIsSkill=true',
            updatedAt: '2026-05-09T18:10:00.000Z',
          },
          {
            agentDocumentId: 'agent-doc-2',
            documentId: 'doc-2',
            hintIsSkill: true,
            reason: 'metadata.agentSignal.hintIsSkill=true',
            updatedAt: '2026-05-09T18:20:00.000Z',
          },
        ],
      },
      feedbackActivity: createEmptyFeedbackActivityForTest(),
      receiptActivity: createEmptyReceiptActivityForTest(),
      toolActivity: [],
    });

    expect(signals).toContainEqual(
      expect.objectContaining({
        kind: 'skill_documents_maybe_overlap',
        strength: 'medium',
      }),
    );
  });

  /**
   * @example
   * Pending receipts should create a suppression-oriented weak signal.
   */
  it('creates pending proposal signals from receipt activity', () => {
    expect(
      deriveNightlyMaintenanceSignals({
        documentActivity: createEmptyDocumentActivityForTest(),
        feedbackActivity: createEmptyFeedbackActivityForTest(),
        receiptActivity: {
          appliedCount: 0,
          duplicateGroups: [{ count: 2, key: 'skill:release', receiptIds: ['receipt-1'] }],
          failedCount: 0,
          pendingProposalCount: 1,
          recentReceipts: [
            {
              id: 'receipt-1',
              kind: 'skill',
              status: 'proposed',
              summary: 'Pending release skill refinement.',
            },
          ],
          reviewCount: 1,
        },
        toolActivity: [],
      }),
    ).toContainEqual(
      expect.objectContaining({
        evidenceRefs: [{ id: 'receipt-1', type: 'receipt' }],
        kind: 'pending_related_proposal_exists',
        strength: 'weak',
      }),
    );
  });

  /**
   * @example
   * Existing feedback judgement is a feature only until another bucket creates a signal.
   */
  it('adds satisfaction features without creating standalone feedback signals', () => {
    const feedbackActivity: FeedbackActivityDigest = {
      neutralCount: 0,
      notSatisfied: [
        {
          confidence: 0.91,
          createdAt: '2026-05-09T18:00:00.000Z',
          evidence: 'User was unhappy with repeated validation failures.',
          messageId: 'msg-feedback',
          reason: 'negative correction',
          result: 'not_satisfied',
          topicId: 'topic-1',
        },
      ],
      satisfied: [],
    };

    expect(
      deriveNightlyMaintenanceSignals({
        documentActivity: createEmptyDocumentActivityForTest(),
        feedbackActivity,
        receiptActivity: createEmptyReceiptActivityForTest(),
        toolActivity: [],
      }),
    ).toEqual([]);

    expect(
      deriveNightlyMaintenanceSignals({
        documentActivity: createEmptyDocumentActivityForTest(),
        feedbackActivity,
        receiptActivity: createEmptyReceiptActivityForTest(),
        toolActivity: [
          {
            apiName: 'validate',
            failedCount: 2,
            identifier: 'release-note',
            messageIds: ['msg-1', 'msg-2'],
            sampleArgs: [],
            sampleErrors: ['timeout'],
            topicIds: ['topic-1'],
            totalCount: 2,
          },
        ],
      })[0].features,
    ).toContainEqual(
      expect.objectContaining({
        confidence: 0.91,
        result: 'not_satisfied',
        type: 'feedback_satisfaction',
      }),
    );
  });
});

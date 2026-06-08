import { describe, expect, it, vi } from 'vitest';

import type {
  ListManagedSkillsInput,
  ListRelevantMemoriesInput,
  ListTopicActivityInput,
  NightlyReviewReadAdapters,
} from '../collect';
import { createSelfReviewContextService, mapNightlyDocumentActivityRows } from '../collect';

const REVIEW_INPUT = {
  agentId: 'agent-1',
  reviewWindowEnd: '2026-05-04T23:00:00.000Z',
  reviewWindowStart: '2026-05-04T00:00:00.000Z',
  userId: 'user-1',
};

const createDeps = (
  overrides: Partial<NightlyReviewReadAdapters> = {},
): NightlyReviewReadAdapters => ({
  listManagedSkills: vi
    .fn<
      (
        input: ListManagedSkillsInput,
      ) => Promise<Awaited<ReturnType<NightlyReviewReadAdapters['listManagedSkills']>>>
    >()
    .mockResolvedValue([
      {
        description: 'Keeps bug triage concise.',
        documentId: 'skill-1',
        name: 'bug-triage',
      },
    ]),
  listRelevantMemories: vi
    .fn<
      (
        input: ListRelevantMemoriesInput,
      ) => Promise<Awaited<ReturnType<NightlyReviewReadAdapters['listRelevantMemories']>>>
    >()
    .mockResolvedValue([
      {
        content: 'Prefers short nightly summaries.',
        id: 'memory-1',
      },
    ]),
  listTopicActivity: vi
    .fn<
      (
        input: ListTopicActivityInput,
      ) => Promise<Awaited<ReturnType<NightlyReviewReadAdapters['listTopicActivity']>>>
    >()
    .mockResolvedValue([]),
  ...overrides,
});

describe('mapNightlyDocumentActivityRows', () => {
  /**
   * @example
   * hintIsSkill true rows enter the skill bucket and false rows enter the general bucket.
   */
  it('buckets hinted skill and general document activity separately', () => {
    expect(
      mapNightlyDocumentActivityRows([
        {
          agentDocumentId: 'agent-doc-skill',
          documentId: 'doc-skill',
          hintIsSkill: true,
          policyLoadFormat: 'raw',
          templateId: null,
          title: 'YouTube comments skill',
          updatedAt: new Date('2026-05-09T18:10:00.000Z'),
        },
        {
          agentDocumentId: 'agent-doc-general',
          documentId: 'doc-general',
          hintIsSkill: false,
          policyLoadFormat: 'raw',
          templateId: null,
          title: 'Meeting notes',
          updatedAt: new Date('2026-05-09T18:11:00.000Z'),
        },
      ]),
    ).toEqual({
      ambiguousBucket: [],
      excludedSummary: { count: 0, reasons: [] },
      generalDocumentBucket: [
        expect.objectContaining({
          agentDocumentId: 'agent-doc-general',
          reason: 'metadata.agentSignal.hintIsSkill=false',
        }),
      ],
      skillBucket: [
        expect.objectContaining({
          agentDocumentId: 'agent-doc-skill',
          hintIsSkill: true,
          reason: 'metadata.agentSignal.hintIsSkill=true',
        }),
      ],
    });
  });

  /**
   * @example
   * Existing managed skill templates are still skill bucket evidence even without a hint.
   */
  it('buckets known skill template rows as skill activity', () => {
    expect(
      mapNightlyDocumentActivityRows([
        {
          agentDocumentId: 'agent-doc-index',
          documentId: 'doc-index',
          hintIsSkill: null,
          policyLoadFormat: 'raw',
          templateId: 'skills/index',
          title: 'Skill index',
          updatedAt: new Date('2026-05-09T18:10:00.000Z'),
        },
        {
          agentDocumentId: 'agent-doc-managed-skill',
          documentId: 'doc-managed-skill',
          hintIsSkill: null,
          policyLoadFormat: 'raw',
          templateId: 'agent-skill',
          title: 'Managed skill',
          updatedAt: new Date('2026-05-09T18:11:00.000Z'),
        },
      ]).skillBucket,
    ).toEqual([
      expect.objectContaining({
        agentDocumentId: 'agent-doc-index',
        hintIsSkill: false,
        reason: 'templateId=skills/index',
      }),
      expect.objectContaining({
        agentDocumentId: 'agent-doc-managed-skill',
        hintIsSkill: false,
        reason: 'templateId=agent-skill',
      }),
    ]);
  });
});

describe('nightlyReviewService', () => {
  describe('collect', () => {
    it('ranks high-signal topics first and excludes raw messages while including skills and memories', async () => {
      /**
       * @example
       * expect(topics[0].highSignalReasons).toEqual([
       *   'failure',
       *   'negative_feedback',
       *   'correction',
       *   'failed_tool',
       *   'receipt',
       * ]);
       */
      const deps = createDeps({
        listTopicActivity: vi.fn().mockResolvedValue([
          {
            id: 'topic-ordinary',
            messageCount: 100,
            rawMessages: [{ content: 'raw message must not leak' }],
            summary: 'A long successful discussion.',
          },
          {
            correctionCount: 1,
            correctionIds: [],
            failedToolCount: 1,
            failureCount: 1,
            id: 'topic-high',
            messageCount: 1,
            negativeFeedbackCount: 1,
            rawMessages: [{ content: 'private raw transcript' }],
            receiptCount: 1,
            summary: 'A failed attempt with feedback.',
          },
        ]),
      });
      const service = createSelfReviewContextService(deps);

      const context = await service.collect(REVIEW_INPUT);

      expect(context).toMatchObject({
        agentId: 'agent-1',
        managedSkills: [
          {
            description: 'Keeps bug triage concise.',
            documentId: 'skill-1',
            name: 'bug-triage',
          },
        ],
        relevantMemories: [
          {
            content: 'Prefers short nightly summaries.',
            id: 'memory-1',
          },
        ],
        reviewWindowEnd: '2026-05-04T23:00:00.000Z',
        reviewWindowStart: '2026-05-04T00:00:00.000Z',
        userId: 'user-1',
      });
      expect(context.topics.map((topic) => topic.id)).toEqual(['topic-high', 'topic-ordinary']);
      expect(context.topics[0].highSignalReasons).toEqual([
        'failure',
        'negative_feedback',
        'correction',
        'failed_tool',
        'receipt',
      ]);
      expect(context.topics[0]).toMatchObject({
        correctionCount: 1,
        correctionIds: [],
      });
      expect(context.selfReviewSignals.map((signal) => signal.kind)).not.toContain(
        'durable_user_preference',
      );
      expect(context.topics[0]).not.toHaveProperty('rawMessages');
      expect(context.topics[1]).not.toHaveProperty('rawMessages');
    });

    it('returns empty structured shared buckets when optional adapters are absent', async () => {
      /**
       * @example
       * expect(context.selfReviewSignals).toEqual([]).
       */
      const service = createSelfReviewContextService({
        listManagedSkills: async () => [],
        listRelevantMemories: async () => [],
        listTopicActivity: async () => [],
      });

      await expect(service.collect(REVIEW_INPUT)).resolves.toMatchObject({
        documentActivity: {
          ambiguousBucket: [],
          excludedSummary: { count: 0, reasons: [] },
          generalDocumentBucket: [],
          skillBucket: [],
        },
        feedbackActivity: { neutralCount: 0, notSatisfied: [], satisfied: [] },
        selfReviewSignals: [],
        proposalActivity: {
          active: [],
          dismissedCount: 0,
          expiredCount: 0,
          staleCount: 0,
          supersededCount: 0,
        },
        receiptActivity: {
          appliedCount: 0,
          duplicateGroups: [],
          failedCount: 0,
          pendingProposalCount: 0,
          recentReceipts: [],
          reviewCount: 0,
        },
        selfFeedbackCandidates: [],
        toolActivity: [],
      });
    });

    it('includes pending proposal activity from the proposal adapter', async () => {
      /**
       * @example
       * expect(context.proposalActivity.active[0].proposalId).toBe('brf_1').
       */
      const service = createSelfReviewContextService({
        listManagedSkills: async () => [],
        listProposalActivity: async () => ({
          active: [
            {
              actionType: 'refine_skill',
              createdAt: '2026-05-09T00:00:00.000Z',
              evidenceCount: 2,
              expiresAt: '2026-05-12T00:00:00.000Z',
              proposalId: 'brf_1',
              proposalKey: 'agt_1:refine_skill:agent_document:adoc_1',
              status: 'pending',
              summary: 'Existing skill refinement proposal.',
              targetId: 'adoc_1',
              targetTitle: 'Skill Index',
              updatedAt: '2026-05-09T00:00:00.000Z',
            },
          ],
          dismissedCount: 0,
          expiredCount: 0,
          staleCount: 0,
          supersededCount: 0,
        }),
        listRelevantMemories: async () => [],
        listTopicActivity: async () => [],
      });

      await expect(service.collect(REVIEW_INPUT)).resolves.toMatchObject({
        proposalActivity: {
          active: [{ proposalId: 'brf_1', status: 'pending' }],
        },
      });
    });

    it('clips topic activity to the default max topic budget', async () => {
      /**
       * @example
       * expect(context.topics).toHaveLength(30);
       */
      const deps = createDeps({
        listTopicActivity: vi.fn().mockResolvedValue(
          Array.from({ length: 35 }, (_, index) => ({
            id: `topic-${index}`,
            messageCount: 35 - index,
          })),
        ),
      });
      const service = createSelfReviewContextService(deps);

      const context = await service.collect(REVIEW_INPUT);

      expect(context.topics).toHaveLength(30);
      expect(context.topics.at(-1)?.id).toBe('topic-29');
    });

    it('keeps high-signal topics before huge ordinary topics', async () => {
      /**
       * @example
       * expect(context.topics.map((topic) => topic.id)).toEqual(['topic-receipt', 'topic-huge']);
       */
      const deps = createDeps({
        listTopicActivity: vi.fn().mockResolvedValue([
          {
            id: 'topic-huge',
            messageCount: 100_000,
            summary: 'A very long but ordinary successful discussion.',
          },
          {
            id: 'topic-receipt',
            messageCount: 1,
            receiptCount: 1,
            summary: 'A small topic with a receipt.',
          },
        ]),
      });
      const service = createSelfReviewContextService(deps);

      const context = await service.collect(REVIEW_INPUT);

      expect(context.topics.map((topic) => topic.id)).toEqual(['topic-receipt', 'topic-huge']);
      expect(context.topics[0].highSignalReasons).toEqual(['receipt']);
      expect(context.topics[1].highSignalReasons).toEqual([]);
    });

    it('preserves evidence refs when provided and synthesizes topic refs when missing', async () => {
      /**
       * @example
       * expect(context.topics[1].evidenceRefs).toEqual([{ id: 'topic-missing', type: 'topic' }]);
       */
      const deps = createDeps({
        listTopicActivity: vi.fn().mockResolvedValue([
          {
            evidenceRefs: [
              { id: 'message-1', summary: 'User corrected the answer.', type: 'message' },
            ],
            id: 'topic-preserved',
            messageCount: 2,
          },
          {
            id: 'topic-missing',
            messageCount: 1,
          },
        ]),
      });
      const service = createSelfReviewContextService(deps);

      const context = await service.collect(REVIEW_INPUT);

      expect(context.topics[0].evidenceRefs).toEqual([
        { id: 'message-1', summary: 'User corrected the answer.', type: 'message' },
      ]);
      expect(context.topics[1].evidenceRefs).toEqual([{ id: 'topic-missing', type: 'topic' }]);
    });

    it('keeps bounded failed tool evidence and uses it as evidence refs', async () => {
      /**
       * @example
       * expect(context.topics[0].failedToolCalls[0].errorSummary).toContain('timeout').
       */
      const deps = createDeps({
        listTopicActivity: vi.fn().mockResolvedValue([
          {
            failedMessages: [{ errorSummary: '{"message":"model failed"}', messageId: 'msg-1' }],
            failedToolCalls: [
              {
                apiName: 'search',
                errorSummary: '{"message":"timeout"}',
                identifier: 'web-search',
                messageId: 'msg-2',
                toolCallId: 'tool-call-1',
              },
            ],
            id: 'topic-failed-tools',
            messageCount: 3,
          },
        ]),
      });
      const service = createSelfReviewContextService(deps);

      const context = await service.collect(REVIEW_INPUT);

      expect(context.topics[0]).toMatchObject({
        failedMessages: [{ errorSummary: '{"message":"model failed"}', messageId: 'msg-1' }],
        failedToolCalls: [
          {
            apiName: 'search',
            errorSummary: '{"message":"timeout"}',
            identifier: 'web-search',
            messageId: 'msg-2',
            toolCallId: 'tool-call-1',
          },
        ],
      });
      expect(context.topics[0].evidenceRefs).toEqual([
        { id: 'topic-failed-tools', type: 'topic' },
        { id: 'msg-1', type: 'message' },
        { id: 'tool-call-1', type: 'tool_call' },
      ]);
    });

    it('uses id tie-breakers when last activity timestamps are invalid', async () => {
      /**
       * @example
       * expect(context.topics.map((topic) => topic.id)).toEqual(['topic-a', 'topic-b']);
       */
      const deps = createDeps({
        listTopicActivity: vi.fn().mockResolvedValue([
          {
            id: 'topic-b',
            lastActivityAt: 'not-a-date',
            messageCount: 1,
          },
          {
            id: 'topic-a',
            lastActivityAt: 'also-not-a-date',
            messageCount: 1,
          },
        ]),
      });
      const service = createSelfReviewContextService(deps);

      const context = await service.collect(REVIEW_INPUT);

      expect(context.topics.map((topic) => topic.id)).toEqual(['topic-a', 'topic-b']);
    });

    it('removes raw transcript payload keys from topic attributes while keeping safe attributes', async () => {
      /**
       * @example
       * expect(context.topics[0].attributes).toEqual({ safeLabel: 'billing' });
       */
      const deps = createDeps({
        listTopicActivity: vi.fn().mockResolvedValue([
          {
            attributes: {
              messages: [{ content: 'raw message' }],
              rawMessages: [{ content: 'raw transcript' }],
              safeLabel: 'billing',
              transcript: 'raw transcript text',
              transcripts: ['raw transcript text'],
            },
            id: 'topic-with-attributes',
            messageCount: 1,
          },
        ]),
      });
      const service = createSelfReviewContextService(deps);

      const context = await service.collect(REVIEW_INPUT);

      expect(context.topics[0].attributes).toEqual({ safeLabel: 'billing' });
    });

    it('keeps ordinary successful topics low-scored with no high-signal reasons', async () => {
      /**
       * @example
       * expect(context.topics[0].highSignalReasons).toEqual([]);
       */
      const deps = createDeps({
        listTopicActivity: vi.fn().mockResolvedValue([
          {
            id: 'topic-success',
            messageCount: 4,
            summary: 'A successful ordinary exchange.',
          },
        ]),
      });
      const service = createSelfReviewContextService(deps);

      const context = await service.collect(REVIEW_INPUT);

      expect(context.topics[0]).toMatchObject({
        highSignalReasons: [],
        id: 'topic-success',
        reviewScore: 4,
      });
    });

    it('maps reflection intent receipt metadata into ranked review candidates', async () => {
      /**
       * @example
       * expect(context.selfFeedbackCandidates[0].reviewBehavior).toBe('proposal_priority');
       */
      const service = createSelfReviewContextService({
        listManagedSkills: async () => [],
        listReceiptActivity: async () => ({
          appliedCount: 0,
          duplicateGroups: [],
          failedCount: 0,
          pendingProposalCount: 0,
          recentReceipts: [
            {
              id: 'receipt-reflection-1',
              kind: 'review',
              metadata: {
                selfIteration: {
                  intents: [
                    {
                      actionType: 'refine_skill',
                      confidence: 0.9,
                      evidenceRefs: [{ id: 'tool-call-1', type: 'tool_call' }],
                      idempotencyKey: 'intent-refine-skill-1',
                      intentType: 'skill',
                      mode: 'reflection',
                      operation: {
                        domain: 'skill',
                        input: {
                          bodyMarkdown: '# Skill',
                          skillDocumentId: 'skill-1',
                          userId: 'user-1',
                        },
                        operation: 'refine',
                      },
                      rationale: 'The agent repeatedly failed the same local checklist.',
                      risk: 'medium',
                      target: { skillDocumentId: 'skill-1' },
                      urgency: 'soon',
                    },
                  ],
                  mode: 'reflection',
                },
              },
              status: 'completed',
            },
          ],
          reviewCount: 1,
        }),
        listRelevantMemories: async () => [],
        listTopicActivity: async () => [],
      });

      const context = await service.collect(REVIEW_INPUT);

      expect(context.selfFeedbackCandidates).toHaveLength(1);
      expect(context.selfFeedbackCandidates[0]).toMatchObject({
        confidence: 0.9,
        evidenceStrength: 'strong',
        reviewBehavior: 'proposal_priority',
      });
      expect(context.selfFeedbackCandidates[0].intent.operation).toMatchObject({
        domain: 'skill',
        operation: 'refine',
      });
    });
  });
});

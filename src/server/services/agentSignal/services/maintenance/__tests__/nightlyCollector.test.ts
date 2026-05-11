import { describe, expect, it, vi } from 'vitest';

import type {
  ListManagedSkillsInput,
  ListRelevantMemoriesInput,
  ListTopicActivityInput,
  NightlyReviewReadAdapters,
} from '../nightlyCollector';
import { createNightlyReviewService } from '../nightlyCollector';

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

describe('nightlyReviewService', () => {
  describe('collectNightlyReviewContext', () => {
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
      const service = createNightlyReviewService(deps);

      const context = await service.collectNightlyReviewContext(REVIEW_INPUT);

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
      expect(context.maintenanceSignals.map((signal) => signal.kind)).not.toContain(
        'durable_user_preference',
      );
      expect(context.topics[0]).not.toHaveProperty('rawMessages');
      expect(context.topics[1]).not.toHaveProperty('rawMessages');
    });

    it('returns empty structured maintenance buckets when optional adapters are absent', async () => {
      /**
       * @example
       * expect(context.maintenanceSignals).toEqual([]).
       */
      const service = createNightlyReviewService({
        listManagedSkills: async () => [],
        listRelevantMemories: async () => [],
        listTopicActivity: async () => [],
      });

      await expect(service.collectNightlyReviewContext(REVIEW_INPUT)).resolves.toMatchObject({
        documentActivity: {
          ambiguousBucket: [],
          excludedSummary: { count: 0, reasons: [] },
          generalDocumentBucket: [],
          skillBucket: [],
        },
        feedbackActivity: { neutralCount: 0, notSatisfied: [], satisfied: [] },
        maintenanceSignals: [],
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
        toolActivity: [],
      });
    });

    it('includes pending proposal activity from the proposal adapter', async () => {
      /**
       * @example
       * expect(context.proposalActivity.active[0].proposalId).toBe('brf_1').
       */
      const service = createNightlyReviewService({
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

      await expect(service.collectNightlyReviewContext(REVIEW_INPUT)).resolves.toMatchObject({
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
      const service = createNightlyReviewService(deps);

      const context = await service.collectNightlyReviewContext(REVIEW_INPUT);

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
      const service = createNightlyReviewService(deps);

      const context = await service.collectNightlyReviewContext(REVIEW_INPUT);

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
      const service = createNightlyReviewService(deps);

      const context = await service.collectNightlyReviewContext(REVIEW_INPUT);

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
      const service = createNightlyReviewService(deps);

      const context = await service.collectNightlyReviewContext(REVIEW_INPUT);

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
      const service = createNightlyReviewService(deps);

      const context = await service.collectNightlyReviewContext(REVIEW_INPUT);

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
      const service = createNightlyReviewService(deps);

      const context = await service.collectNightlyReviewContext(REVIEW_INPUT);

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
      const service = createNightlyReviewService(deps);

      const context = await service.collectNightlyReviewContext(REVIEW_INPUT);

      expect(context.topics[0]).toMatchObject({
        highSignalReasons: [],
        id: 'topic-success',
        reviewScore: 4,
      });
    });
  });
});

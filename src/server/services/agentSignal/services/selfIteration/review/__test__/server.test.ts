// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BriefItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import type * as SkillManagementModule from '@/server/services/skillManagement';

import type * as ToolFirstRuntimeModule from '../../execute';
import { listServerSelfReviewProposalActivity } from '../../server';
import { ActionStatus, ReviewRunStatus } from '../../types';
import type { NightlyReviewContext } from '../collect';
import { createServerSelfReviewPolicyOptions } from '../server';

const mocks = vi.hoisted(() => ({
  briefCreate: vi.fn(),
  briefListUnresolvedByAgentAndTrigger: vi.fn(async () => []),
  briefUpdateMetadata: vi.fn(),
  initModelRuntimeFromDB: vi.fn(async () => ({ chat: vi.fn() })),
  executeSelfIteration: vi.fn(),
  skillReadTargetSnapshot: vi.fn(),
  skillReplaceSkillIndex: vi.fn(),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: mocks.initModelRuntimeFromDB,
}));

vi.mock('../../execute', async (importOriginal) => ({
  ...(await importOriginal<typeof ToolFirstRuntimeModule>()),
  executeSelfIteration: mocks.executeSelfIteration,
}));

vi.mock('@/database/models/agentSignal/nightlyReview', () => ({
  AgentSignalNightlyReviewModel: class {
    listActiveAgentTargets = vi.fn(async () => []);
  },
}));

vi.mock('@/database/models/agentSignal/reviewContext', () => ({
  AgentSignalReviewContextModel: class {
    canAgentRunSelfIteration = vi.fn(async () => true);
    listDocumentActivity = vi.fn(async () => []);
    listRelevantMemories = vi.fn(async () => []);
    listToolActivity = vi.fn(async () => []);
    listTopicActivity = vi.fn(async () => []);
  },
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: class {
    create = mocks.briefCreate;
    listUnresolvedByAgentAndTrigger = mocks.briefListUnresolvedByAgentAndTrigger;
    updateMetadata = mocks.briefUpdateMetadata;
  },
}));

vi.mock('@/server/services/skillManagement', async (importOriginal) => ({
  ...(await importOriginal<typeof SkillManagementModule>()),
  SkillManagementDocumentService: class {
    createSkill = vi.fn();
    getSkill = vi.fn();
    listSkills = vi.fn(async () => []);
    readSkillTargetSnapshot = mocks.skillReadTargetSnapshot;
    replaceSkillIndex = mocks.skillReplaceSkillIndex;
  },
}));

vi.mock('@/server/services/agentSignal/featureGate', () => ({
  isAgentSignalEnabledForUser: vi.fn(async () => true),
}));

const baseBrief = (overrides: Partial<BriefItem>): BriefItem => ({
  actions: null,
  agentId: 'agent-1',
  artifacts: null,
  createdAt: new Date('2026-05-09T00:00:00.000Z'),
  cronJobId: null,
  id: 'brief-1',
  metadata: null,
  priority: 'normal',
  readAt: null,
  resolvedAction: null,
  resolvedAt: null,
  resolvedComment: null,
  summary: 'Proposal summary',
  taskId: null,
  title: 'Proposal',
  topicId: null,
  trigger: 'agent-signal:nightly-review',
  type: 'decision',
  userId: 'user-1',
  ...overrides,
});

const proposalMetadata = (
  overrides: Record<string, unknown> = {},
): NonNullable<BriefItem['metadata']> => ({
  agentSignal: {
    nightlySelfReview: {
      selfReviewProposal: {
        actionType: 'refine_skill',
        actions: [
          {
            actionType: 'refine_skill',
            baseSnapshot: { targetTitle: 'Skill Index' },
            evidenceRefs: [
              { id: 'topic-1', type: 'topic' },
              { id: 'message-1', type: 'message' },
            ],
            idempotencyKey: 'source:refine_skill:skill:adoc-1',
            rationale: 'Refine the skill.',
            risk: 'medium',
            target: { skillDocumentId: 'adoc-1' },
          },
        ],
        createdAt: '2026-05-09T00:00:00.000Z',
        evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
        evidenceWindowEnd: '2026-05-09T02:00:00.000Z',
        evidenceWindowStart: '2026-05-09T00:00:00.000Z',
        expiresAt: '2026-05-12T00:00:00.000Z',
        proposalKey: 'agent-1:refine_skill:agent_document:adoc-1',
        status: 'pending',
        updatedAt: '2026-05-09T01:00:00.000Z',
        version: 1,
        ...overrides,
      },
    },
  },
});

const createNightlyContext = (): NightlyReviewContext => ({
  agentId: 'agent-1',
  documentActivity: {
    ambiguousBucket: [],
    excludedSummary: { count: 0, reasons: [] },
    generalDocumentBucket: [],
    skillBucket: [],
  },
  feedbackActivity: {
    neutralCount: 0,
    notSatisfied: [],
    satisfied: [],
  },
  selfReviewSignals: [],
  managedSkills: [],
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
  relevantMemories: [],
  reviewWindowEnd: '2026-05-09T02:00:00.000Z',
  reviewWindowStart: '2026-05-09T00:00:00.000Z',
  selfFeedbackCandidates: [],
  toolActivity: [],
  topics: [],
  userId: 'user-1',
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.briefCreate.mockResolvedValue(baseBrief({ id: 'brief-created' }));
  mocks.briefListUnresolvedByAgentAndTrigger.mockResolvedValue([]);
  mocks.briefUpdateMetadata.mockResolvedValue(undefined);
  mocks.initModelRuntimeFromDB.mockResolvedValue({ chat: vi.fn() });
  mocks.skillReadTargetSnapshot.mockResolvedValue(undefined);
  mocks.skillReplaceSkillIndex.mockResolvedValue(undefined);
  mocks.executeSelfIteration.mockResolvedValue({
    content: 'Created a skill.',
    stepCount: 3,
    toolCalls: [
      {
        apiName: 'createSkillIfAbsent',
        arguments: JSON.stringify({
          bodyMarkdown: 'Use concise answers.',
          idempotencyKey: 'op-create-skill',
          name: 'concise-answers',
          title: 'Concise answers',
        }),
        id: 'tool-call-1',
        identifier: 'agent-signal-self-iteration',
        type: 'builtin',
      },
    ],
    usage: [],
    writeOutcomes: [
      {
        result: {
          receiptId: 'op-create-skill',
          resourceId: 'skill-1',
          status: 'applied',
          summary: 'Created managed skill concise-answers.',
        },
        toolName: 'createSkillIfAbsent',
      },
    ],
  });
});

afterEach(() => {
  delete (globalThis as { __agentSignalRedisClient?: unknown }).__agentSignalRedisClient;
});

const createSkillProposalToolArguments = () => ({
  actions: [
    {
      actionType: 'create_skill',
      applyMode: 'proposal_only',
      baseSnapshot: {
        absent: true,
        skillName: 'concise-answers',
        targetType: 'skill',
      },
      confidence: 0.9,
      dedupeKey: 'skill:concise-answers',
      evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
      idempotencyKey: 'source-1:create_skill:concise-answers',
      operation: {
        domain: 'skill',
        input: {
          bodyMarkdown: 'Prefer concise answers.',
          name: 'concise-answers',
          title: 'Concise answers',
          userId: 'user-1',
        },
        operation: 'create',
      },
      rationale: 'User repeatedly asks for concise answers.',
      risk: 'low',
      target: { skillName: 'concise-answers' },
    },
  ],
  idempotencyKey: 'proposal-op-1',
  proposalKey: 'agent-1:create_skill:skill:concise-answers',
  summary: 'Review concise answers skill.',
});

describe('listServerSelfReviewProposalActivity', () => {
  /**
   * @example
   * listServerSelfReviewProposalActivity skips malformed metadata and maps active proposal targets.
   */
  it('filters invalid metadata and maps active proposal target digests', async () => {
    const digest = await listServerSelfReviewProposalActivity({
      agentId: 'agent-1',
      briefModel: {
        listUnresolvedByAgentAndTrigger: async () => [
          baseBrief({ id: 'invalid', metadata: { proposal: { status: 'pending' } } }),
          baseBrief({
            agentId: 'other-agent',
            id: 'other-agent',
            metadata: proposalMetadata(),
          }),
          baseBrief({
            id: 'other-trigger',
            metadata: proposalMetadata(),
            trigger: 'other-trigger',
          }),
          baseBrief({ id: 'active', metadata: proposalMetadata() }),
        ],
      },
      now: '2026-05-09T01:00:00.000Z',
      userId: 'user-1',
    });

    expect(digest).toMatchObject({
      dismissedCount: 0,
      expiredCount: 0,
      staleCount: 0,
      supersededCount: 0,
    });
    expect(digest.active).toEqual([
      {
        actionType: 'refine_skill',
        createdAt: '2026-05-09T00:00:00.000Z',
        evidenceCount: 2,
        expiresAt: '2026-05-12T00:00:00.000Z',
        proposalId: 'active',
        proposalKey: 'agent-1:refine_skill:agent_document:adoc-1',
        status: 'pending',
        summary: 'Proposal summary',
        targetId: 'adoc-1',
        targetTitle: 'Skill Index',
        updatedAt: '2026-05-09T01:00:00.000Z',
      },
    ]);
  });

  /**
   * @example
   * listServerSelfReviewProposalActivity passes trigger and agent filters to the brief reader.
   */
  it('queries unresolved proposal briefs by trigger and agent before the read cap', async () => {
    const calls: Array<{ agentId: string; limit?: number; trigger: string }> = [];

    await listServerSelfReviewProposalActivity({
      agentId: 'agent-1',
      briefModel: {
        listUnresolvedByAgentAndTrigger: async (options) => {
          calls.push(options);

          return [];
        },
      },
      userId: 'user-1',
    });

    expect(calls).toEqual([
      {
        agentId: 'agent-1',
        limit: 20,
        trigger: 'agent-signal:nightly-review',
      },
    ]);
  });

  /**
   * @example
   * listServerSelfReviewProposalActivity excludes expired pending proposals from active activity.
   */
  it('counts expired pending proposals as expired instead of active', async () => {
    const digest = await listServerSelfReviewProposalActivity({
      agentId: 'agent-1',
      briefModel: {
        listUnresolvedByAgentAndTrigger: async () => [
          baseBrief({
            id: 'expired-pending',
            metadata: proposalMetadata({ expiresAt: '2026-05-10T00:00:00.000Z' }),
          }),
        ],
      },
      now: '2026-05-10T00:00:00.000Z',
      userId: 'user-1',
    });

    expect(digest.active).toEqual([]);
    expect(digest.expiredCount).toBe(1);
  });

  /**
   * @example
   * listServerSelfReviewProposalActivity ignores legacy noop proposal metadata.
   */
  it('skips noop proposal metadata from active activity', async () => {
    const digest = await listServerSelfReviewProposalActivity({
      agentId: 'agent-1',
      briefModel: {
        listUnresolvedByAgentAndTrigger: async () => [
          baseBrief({
            id: 'noop',
            metadata: proposalMetadata({
              actionType: 'noop',
              actions: [
                {
                  actionType: 'noop',
                  evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
                  idempotencyKey: 'source:noop:quiet',
                  rationale: 'No self-iteration needed.',
                  risk: 'low',
                },
              ],
              proposalKey: 'agent-1:noop:unknown:noop',
            }),
          }),
        ],
      },
      userId: 'user-1',
    });

    expect(digest.active).toEqual([]);
  });

  /**
   * @example
   * listServerSelfReviewProposalActivity keeps unexpired pending proposals in active activity.
   */
  it('keeps future pending proposals active', async () => {
    const digest = await listServerSelfReviewProposalActivity({
      agentId: 'agent-1',
      briefModel: {
        listUnresolvedByAgentAndTrigger: async () => [
          baseBrief({
            id: 'future-pending',
            metadata: proposalMetadata({ expiresAt: '2026-05-10T00:00:01.000Z' }),
          }),
        ],
      },
      now: '2026-05-10T00:00:00.000Z',
      userId: 'user-1',
    });

    expect(digest.active.map((proposal) => proposal.proposalId)).toEqual(['future-pending']);
    expect(digest.expiredCount).toBe(0);
  });

  /**
   * @example
   * listServerSelfReviewProposalActivity prefers skillDocumentId when a proposal target has multiple ids.
   */
  it('uses proposal key target priority when mapping active proposal target ids', async () => {
    const digest = await listServerSelfReviewProposalActivity({
      agentId: 'agent-1',
      briefModel: {
        listUnresolvedByAgentAndTrigger: async () => [
          baseBrief({
            id: 'multi-target',
            metadata: proposalMetadata({
              actions: [
                {
                  actionType: 'refine_skill',
                  evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
                  idempotencyKey: 'source:refine_skill:skill:adoc-1',
                  rationale: 'Refine the skill.',
                  risk: 'medium',
                  target: {
                    memoryId: 'mem-1',
                    skillDocumentId: 'adoc-1',
                    skillName: 'skill-name',
                  },
                },
              ],
            }),
          }),
        ],
      },
      now: '2026-05-09T01:00:00.000Z',
      userId: 'user-1',
    });

    expect(digest.active[0]?.targetId).toBe('adoc-1');
  });

  /**
   * @example
   * listServerSelfReviewProposalActivity counts inactive unresolved proposal statuses without listing them as active.
   */
  it('separates active proposals from inactive unresolved proposal status counts', async () => {
    const digest = await listServerSelfReviewProposalActivity({
      agentId: 'agent-1',
      briefModel: {
        listUnresolvedByAgentAndTrigger: async () => [
          baseBrief({ id: 'accepted', metadata: proposalMetadata({ status: 'accepted' }) }),
          baseBrief({ id: 'dismissed', metadata: proposalMetadata({ status: 'dismissed' }) }),
          baseBrief({ id: 'expired', metadata: proposalMetadata({ status: 'expired' }) }),
          baseBrief({ id: 'stale', metadata: proposalMetadata({ status: 'stale' }) }),
          baseBrief({ id: 'superseded', metadata: proposalMetadata({ status: 'superseded' }) }),
        ],
      },
      userId: 'user-1',
    });

    expect(digest.active.map((proposal) => proposal.proposalId)).toEqual(['accepted']);
    expect(digest.dismissedCount).toBe(1);
    expect(digest.expiredCount).toBe(1);
    expect(digest.staleCount).toBe(1);
    expect(digest.supersededCount).toBe(1);
  });
});

describe('createServerSelfReviewPolicyOptions', () => {
  /**
   * @example
   * createServerSelfReviewPolicyOptions delegates nightly mutation authority to the
   * tool-first runtime instead of the legacy reviewer -> planner -> executor chain.
   */
  it('runs nightly shared through the tool-first runtime with DB model runtime and real tools', async () => {
    const modelRuntime = { chat: vi.fn() };
    mocks.initModelRuntimeFromDB.mockResolvedValue(modelRuntime);

    const options = createServerSelfReviewPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });
    const result = await options.runSelfReviewAgent({
      context: createNightlyContext(),
      localDate: '2026-05-09',
      sourceId: 'nightly-review:user-1:agent-1:2026-05-09',
      userId: 'user-1',
    });

    expect(mocks.initModelRuntimeFromDB).toHaveBeenCalledTimes(1);
    expect(mocks.executeSelfIteration).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        maxSteps: 10,
        modelRuntime,
        sourceId: 'nightly-review:user-1:agent-1:2026-05-09',
        userId: 'user-1',
      }),
    );
    expect(result.stepCount).toBe(3);
    expect(result.execution).toMatchObject({
      actions: [
        {
          idempotencyKey: 'op-create-skill',
          resourceId: 'skill-1',
          status: ActionStatus.Applied,
        },
      ],
      sourceId: 'nightly-review:user-1:agent-1:2026-05-09',
      status: ReviewRunStatus.Completed,
    });
    expect(result.projectionPlan.actions).toHaveLength(1);
    expect(result.projectionPlan.actions[0]).toMatchObject({
      actionType: 'create_skill',
      idempotencyKey: 'op-create-skill',
    });
  });

  /**
   * @example
   * createServerSelfReviewPolicyOptions exposes createSelfReviewProposal with real brief
   * persistence instead of returning an unsupported tool result.
   */
  it('persists proposal lifecycle tool writes through Daily Brief proposal metadata', async () => {
    const modelRuntime = { chat: vi.fn() };
    const toolArguments = createSkillProposalToolArguments();
    (globalThis as { __agentSignalRedisClient?: unknown }).__agentSignalRedisClient = {
      expire: vi.fn(async () => 1),
      hgetall: vi.fn(async () => ({})),
      hset: vi.fn(async () => 1),
      set: vi.fn(async () => 'OK'),
      zadd: vi.fn(async () => 1),
    };
    mocks.initModelRuntimeFromDB.mockResolvedValue(modelRuntime);
    mocks.executeSelfIteration.mockImplementation(async (input) => {
      const result = await input.tools.createSelfReviewProposal({
        actions: toolArguments.actions,
        idempotencyKey: toolArguments.idempotencyKey,
        metadata: {},
        proposalKey: toolArguments.proposalKey,
        summary: toolArguments.summary,
        userId: 'user-1',
      });

      return {
        content: 'Created a proposal.',
        stepCount: 2,
        toolCalls: [
          {
            apiName: 'createSelfReviewProposal',
            arguments: JSON.stringify(toolArguments),
            id: 'call-proposal-1',
            identifier: 'agent-signal-self-iteration',
            type: 'builtin',
          },
        ],
        usage: [],
        writeOutcomes: [{ result, toolName: 'createSelfReviewProposal' }],
      };
    });

    const options = createServerSelfReviewPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });
    const result = await options.runSelfReviewAgent({
      context: createNightlyContext(),
      localDate: '2026-05-09',
      sourceId: 'source-1',
      userId: 'user-1',
    });

    expect(mocks.briefCreate).toHaveBeenCalledTimes(1);
    expect(mocks.briefCreate.mock.calls[0]?.[0]).toMatchObject({
      metadata: {
        agentSignal: {
          nightlySelfReview: {
            selfReviewProposal: {
              actions: [
                {
                  actionType: 'create_skill',
                  operation: {
                    domain: 'skill',
                    operation: 'create',
                  },
                },
              ],
              proposalKey: 'agent-1:create_skill:skill:concise-answers',
              status: 'pending',
            },
          },
        },
      },
      type: 'decision',
    });
    expect(result.execution.actions).toEqual([]);
    expect(result.projectionPlan.actions).toEqual([]);
  });

  /**
   * @example
   * const digest = await tools.getEvidenceDigest({ evidenceIds: ['message-1', 'agent-doc-1'] });
   * expect(digest.topics[0].topicId).toBe('topic-1');
   */
  it('keeps topic and signal context when evidence digest is requested with message or agent document ids', async () => {
    const modelRuntime = { chat: vi.fn() };
    const context: NightlyReviewContext = {
      ...createNightlyContext(),
      documentActivity: {
        ...createNightlyContext().documentActivity,
        skillBucket: [
          {
            agentDocumentId: 'agent-doc-1',
            documentId: 'doc-1',
            hintIsSkill: false,
            reason: 'templateId=agent-skill',
            updatedAt: '2026-05-09T01:00:00.000Z',
          },
        ],
      },
      selfReviewSignals: [
        {
          evidenceRefs: [
            { id: 'message-1', type: 'message' },
            { id: 'agent-doc-1', type: 'agent_document' },
          ],
          features: [],
          kind: 'skill_document_with_tool_failure',
          strength: 'medium',
        },
      ],
      managedSkills: [{ documentId: 'agent-doc-1', name: 'release-note-checklist' }],
      topics: [
        {
          evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
          failedToolCalls: [
            {
              apiName: 'replaceSkillContentCAS',
              messageId: 'message-1',
              toolCallId: 'tool-call-1',
            },
          ],
          failedToolCount: 1,
          highSignalReasons: ['failed_tool'],
          messageCount: 1,
          reviewScore: 4001,
          summary: 'The skill refinement failed.',
          topicId: 'topic-1',
        },
      ],
    };
    mocks.initModelRuntimeFromDB.mockResolvedValue(modelRuntime);
    mocks.executeSelfIteration.mockImplementation(async (input) => {
      const digest = await input.tools.getEvidenceDigest({
        agentId: 'agent-1',
        evidenceIds: ['message-1', 'agent-doc-1'],
        reviewWindowEnd: context.reviewWindowEnd,
        reviewWindowStart: context.reviewWindowStart,
        userId: 'user-1',
      });

      expect(digest).toMatchObject({
        selfReviewSignals: [
          {
            kind: 'skill_document_with_tool_failure',
          },
        ],
        managedSkills: [
          {
            documentId: 'agent-doc-1',
            name: 'release-note-checklist',
          },
        ],
        topics: [
          {
            topicId: 'topic-1',
          },
        ],
      });

      return {
        content: 'Inspected evidence.',
        stepCount: 1,
        toolCalls: [],
        usage: [],
        writeOutcomes: [],
      };
    });

    const options = createServerSelfReviewPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });

    await options.runSelfReviewAgent({
      context,
      localDate: '2026-05-09',
      sourceId: 'source-1',
      userId: 'user-1',
    });
  });

  /**
   * @example
   * createSelfReviewProposal({ actions: [{ actionType: 'refine_skill' }] })
   * snapshots the target skill on the server before creating the approval brief.
   */
  it('enriches refine skill proposals with server-side base snapshots', async () => {
    const modelRuntime = { chat: vi.fn() };
    const toolArguments = {
      actions: [
        {
          actionType: 'refine_skill',
          applyMode: 'proposal_only',
          confidence: 0.9,
          dedupeKey: 'skill:skill-doc-1',
          evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
          idempotencyKey: 'source-1:refine_skill:skill-doc-1',
          operation: {
            domain: 'skill',
            input: {
              bodyMarkdown: 'Updated skill body.',
              skillDocumentId: 'skill-doc-1',
              userId: 'user-1',
            },
            operation: 'refine',
          },
          rationale: 'Repeated tool failures show this skill needs a safer workflow.',
          risk: 'low',
          target: { skillDocumentId: 'skill-doc-1' },
        },
      ],
      idempotencyKey: 'proposal-op-refine-1',
      proposalKey: 'agent-1:refine_skill:agent_document:skill-doc-1',
      summary: 'Review skill refinement.',
    };
    (globalThis as { __agentSignalRedisClient?: unknown }).__agentSignalRedisClient = {
      expire: vi.fn(async () => 1),
      hgetall: vi.fn(async () => ({})),
      hset: vi.fn(async () => 1),
      set: vi.fn(async () => 'OK'),
      zadd: vi.fn(async () => 1),
    };
    mocks.initModelRuntimeFromDB.mockResolvedValue(modelRuntime);
    mocks.skillReadTargetSnapshot.mockResolvedValue({
      agentDocumentId: 'skill-doc-1',
      contentHash: 'hash-before',
      documentId: 'document-1',
      managed: true,
      targetTitle: 'Existing skill',
      writable: true,
    });
    mocks.executeSelfIteration.mockImplementation(async (input) => {
      const result = await input.tools.createSelfReviewProposal({
        actions: toolArguments.actions,
        idempotencyKey: toolArguments.idempotencyKey,
        metadata: {},
        proposalKey: toolArguments.proposalKey,
        summary: toolArguments.summary,
        userId: 'user-1',
      });

      return {
        content: 'Created a refine proposal.',
        stepCount: 2,
        toolCalls: [
          {
            apiName: 'createSelfReviewProposal',
            arguments: JSON.stringify(toolArguments),
            id: 'call-proposal-refine-1',
            identifier: 'agent-signal-self-iteration',
            type: 'builtin',
          },
        ],
        usage: [],
        writeOutcomes: [{ result, toolName: 'createSelfReviewProposal' }],
      };
    });

    const options = createServerSelfReviewPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });
    const result = await options.runSelfReviewAgent({
      context: createNightlyContext(),
      localDate: '2026-05-09',
      sourceId: 'source-1',
      userId: 'user-1',
    });

    expect(mocks.briefCreate).toHaveBeenCalledTimes(1);
    expect(mocks.briefCreate.mock.calls[0]?.[0]).toMatchObject({
      metadata: {
        agentSignal: {
          nightlySelfReview: {
            selfReviewProposal: {
              actions: [
                {
                  actionType: 'refine_skill',
                  baseSnapshot: {
                    agentDocumentId: 'skill-doc-1',
                    contentHash: 'hash-before',
                    documentId: 'document-1',
                    managed: true,
                    targetType: 'skill',
                    writable: true,
                  },
                  operation: {
                    domain: 'skill',
                    operation: 'refine',
                  },
                },
              ],
              proposalKey: 'agent-1:refine_skill:agent_document:skill-doc-1',
              status: 'pending',
            },
          },
        },
      },
      type: 'decision',
    });
    expect(result.execution.actions).toEqual([]);
    expect(result.projectionPlan.actions).toEqual([]);
  });

  /**
   * @example
   * replaceSkillContentCAS({ skillDocumentId: 'skill-index-1', bodyMarkdown: '...' })
   * captures the CAS snapshot and normalizes index ids to bundle ids before preflight.
   */
  it('enriches direct refine skill writes with server-side CAS snapshots', async () => {
    const modelRuntime = { chat: vi.fn() };
    (globalThis as { __agentSignalRedisClient?: unknown }).__agentSignalRedisClient = {
      expire: vi.fn(async () => 1),
      hgetall: vi.fn(async () => ({})),
      hset: vi.fn(async () => 1),
      set: vi.fn(async () => 'OK'),
      zadd: vi.fn(async () => 1),
    };
    mocks.initModelRuntimeFromDB.mockResolvedValue(modelRuntime);
    mocks.skillReadTargetSnapshot.mockResolvedValue({
      agentDocumentId: 'skill-bundle-1',
      contentHash: 'hash-before',
      documentId: 'document-1',
      managed: true,
      targetTitle: 'Existing skill',
      writable: true,
    });
    mocks.skillReplaceSkillIndex.mockResolvedValue({
      bundle: { agentDocumentId: 'skill-bundle-1' },
      name: 'existing-skill',
    });
    mocks.executeSelfIteration.mockImplementation(async (input) => {
      const result = await input.tools.replaceSkillContentCAS({
        bodyMarkdown: 'Updated skill body.',
        idempotencyKey: 'source-1:replaceSkillContentCAS:skill-index-1',
        skillDocumentId: 'skill-index-1',
        userId: 'user-1',
      } as Parameters<typeof input.tools.replaceSkillContentCAS>[0]);

      return {
        content: 'Updated a skill.',
        stepCount: 2,
        toolCalls: [
          {
            apiName: 'replaceSkillContentCAS',
            arguments: JSON.stringify({
              bodyMarkdown: 'Updated skill body.',
              idempotencyKey: 'source-1:replaceSkillContentCAS:skill-index-1',
              skillDocumentId: 'skill-index-1',
            }),
            id: 'call-refine-1',
            identifier: 'agent-signal-self-iteration',
            type: 'builtin',
          },
        ],
        usage: [],
        writeOutcomes: [{ result, toolName: 'replaceSkillContentCAS' }],
      };
    });

    const options = createServerSelfReviewPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });
    const result = await options.runSelfReviewAgent({
      context: createNightlyContext(),
      localDate: '2026-05-09',
      sourceId: 'source-1',
      userId: 'user-1',
    });

    expect(mocks.skillReplaceSkillIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDocumentId: 'skill-bundle-1',
        agentId: 'agent-1',
        bodyMarkdown: 'Updated skill body.',
      }),
    );
    expect(result.execution.actions[0]).toMatchObject({
      idempotencyKey: 'source-1:replaceSkillContentCAS:skill-index-1',
      resourceId: 'skill-bundle-1',
      status: ActionStatus.Applied,
    });
  });
});

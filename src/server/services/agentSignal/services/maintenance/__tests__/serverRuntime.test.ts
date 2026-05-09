// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { BriefItem } from '@/database/schemas';

import { listServerProposalActivity } from '../serverRuntime';

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
  proposal: {
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
});

describe('listServerProposalActivity', () => {
  /**
   * @example
   * listServerProposalActivity skips malformed metadata and maps active proposal targets.
   */
  it('filters invalid metadata and maps active proposal target digests', async () => {
    const digest = await listServerProposalActivity({
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
   * listServerProposalActivity passes trigger and agent filters to the brief reader.
   */
  it('queries unresolved proposal briefs by trigger and agent before the read cap', async () => {
    const calls: Array<{ agentId: string; limit?: number; trigger: string }> = [];

    await listServerProposalActivity({
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
   * listServerProposalActivity excludes expired pending proposals from active activity.
   */
  it('counts expired pending proposals as expired instead of active', async () => {
    const digest = await listServerProposalActivity({
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
   * listServerProposalActivity ignores legacy noop proposal metadata.
   */
  it('skips noop proposal metadata from active activity', async () => {
    const digest = await listServerProposalActivity({
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
                  rationale: 'No maintenance needed.',
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
   * listServerProposalActivity keeps unexpired pending proposals in active activity.
   */
  it('keeps future pending proposals active', async () => {
    const digest = await listServerProposalActivity({
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
   * listServerProposalActivity prefers skillDocumentId when a proposal target has multiple ids.
   */
  it('uses proposal key target priority when mapping active proposal target ids', async () => {
    const digest = await listServerProposalActivity({
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
      userId: 'user-1',
    });

    expect(digest.active[0]?.targetId).toBe('adoc-1');
  });

  /**
   * @example
   * listServerProposalActivity counts inactive unresolved proposal statuses without listing them as active.
   */
  it('separates active proposals from inactive unresolved proposal status counts', async () => {
    const digest = await listServerProposalActivity({
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

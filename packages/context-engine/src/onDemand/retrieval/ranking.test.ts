import type {
  OnDemandContextCandidate,
  OnDemandRetrievalAuthority,
  OnDemandRetrievalScope,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { planOnDemandBudget } from '../budgetPlanner';
import { hashContent } from '../canonical';
import { retrieveOnDemandContext, selectRelevantPersonaFragments } from './ranking';

const scope: OnDemandRetrievalScope = {
  agentId: 'agent-current',
  userId: 'user-current',
  workspaceId: 'workspace-current',
};

const makeCandidate = (input: {
  approval?: OnDemandContextCandidate['approval'];
  authority?: OnDemandRetrievalAuthority;
  conflictKey?: string;
  content: string;
  id: string;
  relevance?: number;
  scope?: OnDemandContextCandidate['scope'];
}): OnDemandContextCandidate => ({
  approval: input.approval ?? { state: 'approved' },
  authority: input.authority ?? 'memory',
  ...(input.conflictKey && { conflictKey: input.conflictKey }),
  content: input.content,
  contentHash: hashContent(input.content),
  id: input.id,
  ...(input.relevance === undefined ? {} : { relevance: input.relevance }),
  scope:
    input.scope ??
    ({
      ownerUserId: scope.userId,
      share: 'personal',
      shareGate: 'allowed',
    } as const),
  source: { id: input.id, type: 'memory' },
});

describe('retrieveOnDemandContext', () => {
  it('returns no entries for no hits', () => {
    const result = retrieveOnDemandContext({
      batch: { candidates: [], durationMs: 1.25, mode: 'none' },
      currentUserMessage: 'nothing relevant',
      scope,
    });

    expect(result.entries).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.metadata).toMatchObject({ hitCount: 0, mode: 'none' });
  });

  it('filters every candidate that is outside the current user, workspace, agent, or share gate', () => {
    const result = retrieveOnDemandContext({
      batch: {
        candidates: [
          makeCandidate({
            content: 'deploy preference from another user',
            id: 'other-user',
            scope: {
              ownerUserId: 'user-other',
              share: 'personal',
              shareGate: 'allowed',
            },
          }),
          makeCandidate({
            content: 'deploy preference from another workspace',
            id: 'other-workspace',
            scope: {
              share: 'workspace',
              shareGate: 'allowed',
              workspaceId: 'workspace-other',
            },
          }),
          makeCandidate({
            content: 'deploy preference from another agent',
            id: 'other-agent',
            scope: {
              agentId: 'agent-other',
              share: 'agent',
              shareGate: 'allowed',
            },
          }),
          makeCandidate({
            content: 'deploy preference denied by share gate',
            id: 'share-denied',
            scope: {
              ownerUserId: scope.userId,
              share: 'personal',
              shareGate: 'denied',
            },
          }),
        ],
        mode: 'vector',
      },
      currentUserMessage: 'deploy preference',
      scope,
    });

    expect(result.entries).toEqual([]);
    expect(result.dropped.map((drop) => drop.reason)).toEqual([
      'scope_denied',
      'scope_denied',
      'scope_denied',
      'scope_denied',
    ]);
  });

  it('keeps all visible scopes while still excluding unknown share state', () => {
    const result = retrieveOnDemandContext({
      batch: {
        candidates: [
          makeCandidate({ content: 'deploy personal', id: 'personal' }),
          makeCandidate({
            content: 'deploy workspace',
            id: 'workspace',
            scope: {
              share: 'workspace',
              shareGate: 'allowed',
              workspaceId: scope.workspaceId,
            },
          }),
          makeCandidate({
            content: 'deploy agent',
            id: 'agent',
            scope: {
              agentId: scope.agentId,
              share: 'agent',
              shareGate: 'allowed',
            },
          }),
          makeCandidate({
            content: 'deploy public',
            id: 'public',
            scope: { share: 'public', shareGate: 'allowed' },
          }),
          makeCandidate({
            content: 'deploy unknown share',
            id: 'unknown',
            scope: { share: 'public', shareGate: 'unknown' },
          }),
        ],
      },
      currentUserMessage: 'deploy',
      scope,
    });

    expect(result.entries.map((entry) => entry.source.id)).toEqual([
      'agent',
      'personal',
      'public',
      'workspace',
    ]);
    expect(result.dropped).toEqual([expect.objectContaining({ reason: 'scope_denied' })]);
  });

  it('resolves conflicts by authority before relevance and makes explicit constraints required', () => {
    const result = retrieveOnDemandContext({
      batch: {
        candidates: [
          makeCandidate({
            authority: 'memory',
            conflictKey: 'runtime',
            content: 'deploy with the remembered command',
            id: 'memory',
            relevance: 1,
          }),
          makeCandidate({
            authority: 'approved_experience',
            conflictKey: 'runtime',
            content: 'deploy with an approved experience',
            id: 'experience',
            relevance: 0.95,
          }),
          makeCandidate({
            authority: 'stable_preference',
            conflictKey: 'runtime',
            content: 'deploy with the stable preference',
            id: 'preference',
            relevance: 0.9,
          }),
          makeCandidate({
            authority: 'explicit_constraint',
            conflictKey: 'runtime',
            content: 'deploy only with the explicit constraint',
            id: 'constraint',
            relevance: 0,
          }),
        ],
      },
      currentUserMessage: 'deploy',
      scope,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      kind: 'explicit_constraint',
      required: true,
      source: { id: 'constraint' },
    });
    expect(result.entries[0].content).toContain('deploy only with the explicit constraint');
    expect(
      result.dropped.filter((drop) => drop.reason === 'higher_priority_conflict'),
    ).toHaveLength(3);
  });

  it('lets stable preferences override approved experiences at equal relevance', () => {
    const result = retrieveOnDemandContext({
      batch: {
        candidates: [
          makeCandidate({
            authority: 'approved_experience',
            conflictKey: 'language',
            content: 'Respond using TypeScript examples',
            id: 'experience',
            relevance: 1,
          }),
          makeCandidate({
            authority: 'stable_preference',
            conflictKey: 'language',
            content: 'Respond using Python examples',
            id: 'preference',
            relevance: 1,
          }),
        ],
      },
      currentUserMessage: 'respond examples language',
      scope,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ kind: 'preference', source: { id: 'preference' } });
    expect(result.dropped).toEqual([
      expect.objectContaining({
        candidate: expect.objectContaining({ id: 'experience' }),
        reason: 'higher_priority_conflict',
      }),
    ]);
  });

  it.each([
    ['pending', undefined],
    ['unknown', undefined],
    ['revoked', undefined],
    ['stale', undefined],
    ['hash_mismatch', hashContent('different approved body')],
  ] as const)(
    'downgrades %s expertise to a non-required unapproved suggestion',
    (state, approvedContentHash) => {
      const result = retrieveOnDemandContext({
        batch: {
          candidates: [
            makeCandidate({
              approval: {
                ...(approvedContentHash && { approvedContentHash }),
                state,
              },
              authority: 'approved_experience',
              content: 'Deploy using the reviewed release checklist',
              id: 'lesson',
              relevance: 1,
            }),
          ],
        },
        currentUserMessage: 'deploy release checklist',
        scope,
      });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        kind: 'unapproved_suggestion',
        required: false,
      });
      expect(result.entries[0].content).toContain('<agent_suggestion');
      expect(result.entries[0].content).toContain(`status="${state}"`);
      expect(result.entries[0].content).not.toContain('<agent_experience');
    },
  );

  it('marks user-approved expertise as approved, never as a hard constraint', () => {
    const content = 'Use the reviewed release checklist';
    const result = retrieveOnDemandContext({
      batch: {
        candidates: [
          makeCandidate({
            approval: { approvedContentHash: hashContent(content), state: 'approved' },
            authority: 'approved_experience',
            content,
            id: 'lesson',
            relevance: 1,
          }),
        ],
      },
      currentUserMessage: 'release checklist',
      scope,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      kind: 'approved_expertise',
      required: false,
    });
    expect(result.entries[0].content).toContain('<agent_experience');
    expect(result.entries[0].content).toContain('status="approved"');
  });

  it('selects only persona sections related to the current message', () => {
    const persona = [
      '## Deployment',
      'Use blue-green deployment and verify health checks.',
      '## Cooking',
      'Prefer low-salt recipes.',
      '## Deployment safety',
      'Never skip rollback validation.',
    ].join('\n');

    const fragments = selectRelevantPersonaFragments(persona, 'deployment safety');

    expect(fragments).toHaveLength(2);
    expect(fragments.join('\n')).toContain('blue-green deployment');
    expect(fragments.join('\n')).toContain('rollback validation');
    expect(fragments.join('\n')).not.toContain('low-salt recipes');
  });

  it('records only hashes and counters in trace-safe retrieval metadata', () => {
    const currentUserMessage = 'private deployment query';
    const content = 'private deployment body';
    const result = retrieveOnDemandContext({
      batch: {
        candidates: [makeCandidate({ content, id: 'private-id', relevance: 1 })],
        durationMs: 2.5,
        mode: 'vector',
      },
      currentUserMessage,
      scope,
    });

    const serialized = JSON.stringify(result.metadata);
    expect(serialized).not.toContain(currentUserMessage);
    expect(serialized).not.toContain(content);
    expect(result.metadata).toMatchObject({
      durationMs: expect.any(Number),
      hitCount: 1,
      mode: 'vector',
      provenanceHash: expect.stringMatching(/^md5:/),
      queryHash: hashContent(currentUserMessage),
    });
  });

  it('never drops required explicit constraints when lower-priority content exceeds the budget', () => {
    const result = retrieveOnDemandContext({
      batch: {
        candidates: [
          makeCandidate({
            authority: 'explicit_constraint',
            content: 'Keep deploy safe',
            id: 'constraint',
            relevance: 0,
          }),
          makeCandidate({
            approval: { state: 'pending' },
            authority: 'approved_experience',
            content: `Unapproved suggestion ${'x'.repeat(600)}`,
            id: 'suggestion',
            relevance: 1,
          }),
        ],
      },
      currentUserMessage: 'deploy safe',
      scope,
    });
    const plan = planOnDemandBudget({
      entries: result.entries,
      fixedTokens: {
        bootstrapTools: 0,
        currentUserMessage: 0,
        protocol: 0,
        userPrompt: 0,
      },
      maxTokens: 0,
    });

    expect(plan.selected.map((entry) => entry.source.id)).toEqual(['constraint']);
    expect(plan.dropped.map((drop) => drop.entry.source.id)).toEqual(['suggestion']);
  });
});

import { describe, expect, it } from 'vitest';

import { buildDecisionRows } from './decisionList';

const decision = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    createdAt: new Date(1000),
    id,
    options: [
      { id: 'a', label: 'Option A' },
      { id: 'answer', label: 'Answer' },
    ],
    question: `Question ${id}`,
    resolution: null,
    resolvedAt: null,
    resolvedByAgentId: null,
    resolvedByUserId: null,
    resolvedOptionId: null,
    status: 'resolved',
    ...extra,
  }) as any;

describe('buildDecisionRows', () => {
  it('attributes each decision to whoever settled it', () => {
    const rows = buildDecisionRows([
      decision('u', { resolvedAt: new Date(3000), resolvedByUserId: 'u1' }),
      decision('a', { resolvedAt: new Date(2000), resolvedByAgentId: 'ag1' }),
      decision('s', { resolvedAt: new Date(1500) }),
      decision('p', { status: 'pending' }),
    ]);

    expect(rows.map((row) => [row.decision.id, row.actor])).toEqual([
      ['p', 'pending'],
      ['u', 'user'],
      ['a', 'agent'],
      ['s', 'system'],
    ]);
  });

  it('drops canceled gates and puts open ones before settled ones', () => {
    const rows = buildDecisionRows([
      decision('old', { resolvedAt: new Date(9000), resolvedByUserId: 'u1' }),
      decision('gone', { status: 'canceled' }),
      decision('open', { createdAt: new Date(10), status: 'pending' }),
    ]);

    expect(rows.map((row) => row.decision.id)).toEqual(['open', 'old']);
  });

  it('keeps a picked option and its note apart', () => {
    const [row] = buildDecisionRows([
      decision('n', {
        resolution: ' use the staging db ',
        resolvedAt: new Date(2000),
        resolvedByUserId: 'u1',
        resolvedOptionId: 'a',
      }),
    ]);

    expect(row).toMatchObject({ choice: 'Option A', note: 'use the staging db' });
  });

  it('treats the words as the answer for the free-text option', () => {
    const [row] = buildDecisionRows([
      decision('w', {
        resolution: 'Only the EU region',
        resolvedAt: new Date(2000),
        resolvedByUserId: 'u1',
        resolvedOptionId: 'answer',
      }),
    ]);

    expect(row.choice).toBe('Only the EU region');
    expect(row.note).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { resolveOnDemandBudgetConfig } from '../budgetConfig';
import { OnDemandBudgetInputError, planOnDemandBudget } from '../budgetPlanner';
import { makeDynamicEntry } from './fixtures';

const fixedTokens = {
  bootstrapTools: 5,
  currentUserMessage: 5,
  protocol: 5,
  userPrompt: 5,
};

describe('planOnDemandBudget', () => {
  it('uses the configurable T93 default allocation and rejects inconsistent overrides', () => {
    expect(resolveOnDemandBudgetConfig()).toEqual({
      dynamicTokens: 15_500,
      reserveTokens: 4_500,
      totalTokens: 20_000,
    });
    expect(resolveOnDemandBudgetConfig(undefined, 128)).toEqual({
      dynamicTokens: 128,
      reserveTokens: 0,
      totalTokens: 128,
    });
    expect(() =>
      resolveOnDemandBudgetConfig({
        dynamicTokens: 18_000,
        reserveTokens: 4_500,
        totalTokens: 20_000,
      }),
    ).toThrow(OnDemandBudgetInputError);
  });

  it('is deterministic regardless of input array order', () => {
    const entries = [
      makeDynamicEntry({ key: 'memory', estimatedTokens: 10, kind: 'memory' }),
      makeDynamicEntry({
        key: 'preference',
        estimatedTokens: 10,
        kind: 'preference',
        relevance: 0.6,
      }),
      makeDynamicEntry({
        key: 'safety',
        estimatedTokens: 10,
        kind: 'safety',
        priority: 1,
      }),
    ];

    const forward = planOnDemandBudget({ entries, fixedTokens, maxTokens: 100 });
    const repeated = planOnDemandBudget({ entries, fixedTokens, maxTokens: 100 });
    const reverse = planOnDemandBudget({
      entries: [...entries].reverse(),
      fixedTokens,
      maxTokens: 100,
    });

    expect(forward).toEqual(repeated);
    expect(forward.hash).toBe(repeated.hash);
    expect(forward).toEqual(reverse);
    expect(forward.selected.map((entry) => entry.key)).toEqual(['safety', 'memory', 'preference']);
  });

  it('retains required entries and every hard-floor category during overflow', () => {
    const entries = [
      makeDynamicEntry({ estimatedTokens: 20, key: 'required', required: true }),
      makeDynamicEntry({ estimatedTokens: 20, key: 'safety', kind: 'safety' }),
      makeDynamicEntry({ estimatedTokens: 20, key: 'pending', kind: 'pending_action' }),
      makeDynamicEntry({ estimatedTokens: 20, key: 'contract', kind: 'tool_contract' }),
      makeDynamicEntry({ estimatedTokens: 1, key: 'optional-memory' }),
    ];

    const decision = planOnDemandBudget({ entries, fixedTokens, maxTokens: 30 });

    expect(decision.status).toBe('hard_floor_overflow');
    expect(decision.selected.map((entry) => entry.key)).toEqual([
      'safety',
      'pending',
      'contract',
      'required',
    ]);
    expect(decision.dropped).toEqual([
      expect.objectContaining({
        entry: expect.objectContaining({ key: 'optional-memory' }),
        reason: 'budget_exceeded',
      }),
    ]);
    expect(decision.hardFloorOverflowTokens).toBe(70);
  });

  it('drops lower-relevance optional entries before higher-relevance entries', () => {
    const entries = [
      makeDynamicEntry({
        estimatedTokens: 30,
        key: 'high-relevance',
        relevance: 0.95,
      }),
      makeDynamicEntry({
        estimatedTokens: 30,
        key: 'low-relevance',
        relevance: 0.1,
      }),
    ];

    const decision = planOnDemandBudget({
      entries,
      fixedTokens: {
        bootstrapTools: 0,
        currentUserMessage: 0,
        protocol: 0,
        userPrompt: 0,
      },
      maxTokens: 40,
    });

    expect(decision.selected.map((entry) => entry.key)).toEqual(['high-relevance']);
    expect(decision.dropped[0].entry.key).toBe('low-relevance');
  });

  it('degrades a low-relevance optional entry into a labelled, recoverable summary card', () => {
    const lowRelevanceContent = `Low relevance details ${'x'.repeat(2_000)}`;
    const decision = planOnDemandBudget({
      entries: [
        makeDynamicEntry({
          estimatedTokens: 10,
          key: 'high-relevance',
          relevance: 0.95,
        }),
        makeDynamicEntry({
          content: lowRelevanceContent,
          estimatedTokens: 150,
          key: 'low-relevance',
          relevance: 0.2,
        }),
      ],
      fixedTokens: {
        bootstrapTools: 0,
        currentUserMessage: 0,
        protocol: 0,
        userPrompt: 0,
      },
      maxDynamicTokens: 140,
      maxTokens: 140,
    });

    const degraded = decision.degraded[0];
    expect(decision.status).toBe('within_budget');
    expect(decision.totalTokens).toBeLessThanOrEqual(140);
    expect(decision.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'high-relevance', status: 'included' }),
        expect.objectContaining({
          key: 'low-relevance',
          originalEstimatedTokens: 150,
          status: 'degraded',
        }),
      ]),
    );
    expect(degraded).toMatchObject({
      entry: expect.objectContaining({ key: 'low-relevance' }),
      reason: 'low_relevance',
    });
    expect(degraded.degradedEntry.content).toContain('<on_demand_summary');
    expect(degraded.degradedEntry.content).toContain('reason="low_relevance"');
    expect(degraded.degradedEntry.content).toContain('original_hash="');
    expect(degraded.degradedEntry.content).toContain('recovery_ref="');
    expect(degraded.degradedEntry.content).not.toBe(lowRelevanceContent);
  });

  it('retains every protected floor verbatim even when the optional budget is exhausted', () => {
    const entries = [
      makeDynamicEntry({
        content: 'pending action body',
        estimatedTokens: 20,
        key: 'pending',
        kind: 'pending_action',
      }),
      makeDynamicEntry({
        content: 'safety rule body',
        estimatedTokens: 20,
        key: 'safety',
        kind: 'safety',
      }),
      makeDynamicEntry({
        content: 'active contract body',
        estimatedTokens: 20,
        key: 'contract',
        kind: 'tool_contract',
      }),
      makeDynamicEntry({
        content: 'optional memory body',
        estimatedTokens: 20,
        key: 'optional',
      }),
    ];
    const decision = planOnDemandBudget({
      entries,
      fixedTokens: {
        activeToolContracts: 40,
        bootstrapTools: 10,
        currentUserMessage: 5,
        protocol: 5,
        userPrompt: 5,
      },
      maxDynamicTokens: 20,
      maxTokens: 200,
      reserveTokens: 10,
    });

    expect(decision.selected.map((entry) => entry.content)).toEqual([
      'safety rule body',
      'pending action body',
      'active contract body',
    ]);
    expect(decision.fixedBreakdown.activeToolContracts).toBe(40);
    expect(decision.decisions.filter((item) => item.status === 'included')).toHaveLength(3);
    expect(decision.totalTokens).toBeLessThanOrEqual(200);
  });

  it('handles empty content without deleting a protected floor', () => {
    const decision = planOnDemandBudget({
      entries: [
        makeDynamicEntry({ content: '', estimatedTokens: 0, key: 'empty-optional' }),
        makeDynamicEntry({
          content: '',
          estimatedTokens: 0,
          key: 'empty-pending',
          kind: 'pending_action',
        }),
      ],
      fixedTokens: {
        bootstrapTools: 0,
        currentUserMessage: 0,
        protocol: 0,
        userPrompt: 0,
      },
      maxTokens: 10,
    });

    expect(decision.selected.map((entry) => entry.key)).toEqual(['empty-pending']);
    expect(decision.dropped).toEqual([
      expect.objectContaining({
        entry: expect.objectContaining({ key: 'empty-optional' }),
        reason: 'empty',
      }),
    ]);
  });

  it('conservatively degrades on estimator failure and never silently drops protected entries', () => {
    const decision = planOnDemandBudget({
      entries: [
        makeDynamicEntry({ content: 'protected safety body', key: 'safety', kind: 'safety' }),
        makeDynamicEntry({
          content: 'protected pending body',
          key: 'pending',
          kind: 'pending_action',
        }),
        makeDynamicEntry({
          content: 'protected contract body',
          key: 'contract',
          kind: 'tool_contract',
        }),
        makeDynamicEntry({ content: 'optional body', key: 'optional' }),
      ],
      estimator: () => {
        throw new Error('tokenizer unavailable');
      },
      estimatorInfo: { id: 'test-estimator', model: 'test-model', provider: 'test-provider' },
      fixedTokens: {
        bootstrapTools: 1,
        currentUserMessage: 1,
        protocol: 1,
        userPrompt: 1,
      },
      maxTokens: 1_000,
    });

    expect(decision.estimatorFailureCount).toBe(4);
    expect(decision.selected.map((entry) => entry.key)).toEqual(['safety', 'pending', 'contract']);
    expect(decision.selected.map((entry) => entry.content)).toEqual([
      'protected safety body',
      'protected pending body',
      'protected contract body',
    ]);
    expect(decision.dropped).toEqual([
      expect.objectContaining({
        entry: expect.objectContaining({ key: 'optional' }),
        reason: 'estimator_failed',
      }),
    ]);
    expect(decision.estimator).toEqual({
      id: 'test-estimator',
      model: 'test-model',
      provider: 'test-provider',
    });
  });

  it('keeps the total at or below the configured ceiling near the limit', () => {
    const decision = planOnDemandBudget({
      entries: [
        makeDynamicEntry({ estimatedTokens: 60, key: 'a', relevance: 0.9 }),
        makeDynamicEntry({ estimatedTokens: 60, key: 'b', relevance: 0.8 }),
        makeDynamicEntry({ estimatedTokens: 60, key: 'c', relevance: 0.7 }),
      ],
      fixedTokens: {
        bootstrapTools: 10,
        currentUserMessage: 10,
        protocol: 10,
        userPrompt: 10,
      },
      maxDynamicTokens: 150,
      maxTokens: 200,
      reserveTokens: 40,
    });

    expect(decision.reserveTokens).toBe(40);
    expect(decision.reserveUsedTokens).toBe(0);
    expect(decision.totalTokens).toBeLessThanOrEqual(200);
    expect(decision.availableDynamicTokens).toBe(120);
  });

  it('never mutates the caller input', () => {
    const entries = Object.freeze([
      makeDynamicEntry({ key: 'b', priority: 2 }),
      makeDynamicEntry({ key: 'a', priority: 1 }),
    ]);
    const before = JSON.stringify(entries);

    planOnDemandBudget({ entries, fixedTokens, maxTokens: 100 });

    expect(JSON.stringify(entries)).toBe(before);
    expect(entries.map((entry) => entry.key)).toEqual(['b', 'a']);
  });

  it('reports a fixed-floor overflow without deleting user or protocol floors', () => {
    const decision = planOnDemandBudget({
      entries: [],
      fixedTokens: {
        bootstrapTools: 10,
        currentUserMessage: 10,
        protocol: 10,
        userPrompt: 10,
      },
      maxTokens: 25,
    });

    expect(decision.status).toBe('hard_floor_overflow');
    expect(decision.fixedTokens).toBe(40);
    expect(decision.hardFloorOverflowTokens).toBe(15);
    expect(decision.selected).toEqual([]);
  });

  it('rejects a floor marker attached to the wrong dynamic kind', () => {
    expect(() =>
      planOnDemandBudget({
        entries: [
          makeDynamicEntry({
            floor: 'safety',
            key: 'invalid-floor',
            kind: 'memory',
          }),
        ],
        fixedTokens,
        maxTokens: 100,
      }),
    ).toThrow(OnDemandBudgetInputError);
  });
});

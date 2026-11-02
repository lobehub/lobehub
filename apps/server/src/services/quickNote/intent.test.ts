import type { DecisionResponse } from '@lobechat/model-runtime';
import type { QuickNoteRunDecision } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  buildQuickNoteIntentQuestions,
  buildQuickNoteIntentState,
  planNeedsGeneration,
  planQuickNoteActions,
  QUICK_NOTE_ACTION_THRESHOLDS,
  QUICK_NOTE_AUTO_APPLY_MIN_SCORE,
  type QuickNoteIntentQuestions,
  toQuickNoteActionLevel,
  toQuickNoteRunDecision,
} from './intent';

const decision = (overrides: Partial<QuickNoteRunDecision> = {}): QuickNoteRunDecision => ({
  decisionMode: 'emulated',
  evidence: '',
  explicitGoalRequest: false,
  preset: null,
  presetScores: { discuss: 0, goal: 0, research: 0, write_document: 0 },
  primary: 'keep',
  scores: { delegate: 0, enrich: 0, keep: 4, link: 0 },
  ...overrides,
});

const score = (value: number, probabilities?: number[]) => ({
  score: value,
  type: 'score' as const,
  ...(probabilities ? { probabilities } : {}),
});

/** One `score` answer per preset question; omitted presets are left unanswered. */
const presets = (
  levels: Partial<Record<'discuss' | 'goal' | 'research' | 'write_document', number>>,
) =>
  Object.fromEntries(
    Object.entries(levels).map(([preset, value]) => [`preset_${preset}`, score(value)]),
  );

/** Native decision model: fractional means, probabilities, no evidence. */
const native = (answers: Record<string, unknown>) =>
  ({
    answers,
    model: 'typesafe/jev-1.13',
    providerMetadata: { lobehub: { decisionMode: 'native' } },
  }) as unknown as DecisionResponse<QuickNoteIntentQuestions>;

/** Emulated decision on a chat model: integer levels and per-question evidence. */
const emulated = (answers: Record<string, unknown>, evidence: Record<string, string> = {}) =>
  ({
    answers,
    model: 'gpt-5-mini',
    providerMetadata: { lobehub: { decisionMode: 'emulated', evidence } },
  }) as unknown as DecisionResponse<QuickNoteIntentQuestions>;

describe('Quick Note intent questions', () => {
  it('asks one score per label and per preset, and the goal boolean only with comments', () => {
    const questions = buildQuickNoteIntentQuestions(false);
    const presetNames = [
      'preset_research',
      'preset_discuss',
      'preset_goal',
      'preset_write_document',
    ];
    expect(Object.keys(questions)).toEqual(['delegate', 'enrich', 'keep', 'link', ...presetNames]);
    expect(Object.keys(buildQuickNoteIntentQuestions(true))).toEqual([
      'delegate',
      'enrich',
      'keep',
      'link',
      ...presetNames,
      'explicitGoalRequest',
    ]);

    for (const name of ['delegate', 'enrich', 'keep', 'link', ...presetNames] as const) {
      const question = questions[name as keyof typeof questions]!;
      expect(question.type).toBe('score');
      expect(question.criteria).toHaveLength(5);
      expect(question.instructions).toBeTruthy();
    }
    expect(questions.preset_goal.instructions).toContain('multi-step objective');

    const goal = buildQuickNoteIntentQuestions(true).explicitGoalRequest!;
    expect(goal.type).toBe('boolean');
    expect(goal.criteria.true).toBeTruthy();
    expect(goal.criteria.false).toBeTruthy();
  });

  it('renders the input snapshot as decision state', () => {
    expect(
      buildQuickNoteIntentState({
        comments: [{ content: 'make it a goal', id: 'c1' }],
        pendingProposals: [{ id: 'p1', kind: 'task', payload: { name: 'x' } as any }],
        source: 'note',
      }),
    ).toEqual({
      comments: ['make it a goal'],
      note: 'note',
      pending_proposals: [{ kind: 'task', payload: { name: 'x' } }],
    });
  });
});

describe('toQuickNoteActionLevel', () => {
  it('rounds to the nearest level but requires 3.5 for level 4', () => {
    expect(QUICK_NOTE_AUTO_APPLY_MIN_SCORE).toBe(3.5);
    expect(
      [0, 1.4, 1.5, 2.49, 2.5, 3.2, 3.49, 3.5, 3.9, 4].map((value) =>
        toQuickNoteActionLevel(value),
      ),
    ).toEqual([0, 1, 2, 2, 3, 3, 3, 4, 4, 4]);
  });

  it('clamps out-of-range and non-finite scores', () => {
    expect(toQuickNoteActionLevel(-1)).toBe(0);
    expect(toQuickNoteActionLevel(7)).toBe(4);
    expect(toQuickNoteActionLevel(Number.NaN)).toBe(0);
  });
});

describe('toQuickNoteRunDecision', () => {
  it('maps a native response with fractional scores and preset probabilities', () => {
    const result = toQuickNoteRunDecision(
      native({
        delegate: score(3.62, [0, 0, 0.05, 0.28, 0.67]),
        enrich: score(1.6),
        keep: score(0.4),
        link: score(0.1),
        ...presets({ discuss: 1.2, goal: 0.4, research: 3.3, write_document: 0.2 }),
      }),
      { provider: 'openrouter' },
    );

    expect(result).toEqual({
      decisionMode: 'native',
      evidence: '',
      explicitGoalRequest: false,
      model: 'typesafe/jev-1.13',
      preset: 'research',
      presetScores: { discuss: 1, goal: 0, research: 3, write_document: 0 },
      primary: 'delegate',
      provider: 'openrouter',
      scores: { delegate: 4, enrich: 2, keep: 0, link: 0 },
    });
  });

  it('maps an emulated response with integer levels and evidence', () => {
    const result = toQuickNoteRunDecision(
      emulated(
        {
          delegate: score(3),
          enrich: score(2),
          keep: score(1),
          link: score(0),
          ...presets({ discuss: 4, goal: 0, research: 2, write_document: 0 }),
        },
        {
          delegate: '"should look into"',
          keep: 'not a record',
          preset_discuss: 'talk it out',
          preset_research: 'could research',
        },
      ),
      { provider: 'openai' },
    );

    expect(result).toMatchObject({
      decisionMode: 'emulated',
      evidence: '"should look into" / talk it out',
      model: 'gpt-5-mini',
      preset: 'discuss',
      presetScores: { discuss: 4, goal: 0, research: 2, write_document: 0 },
      primary: 'delegate',
      provider: 'openai',
      scores: { delegate: 3, enrich: 2, keep: 1, link: 0 },
    });
  });

  it('prefers keep on a tie and drops the preset when delegate is 0', () => {
    const result = toQuickNoteRunDecision(
      emulated({
        delegate: score(0),
        enrich: score(0),
        keep: score(4),
        link: score(0),
        ...presets({ discuss: 0, goal: 0, research: 4, write_document: 0 }),
      }),
      { provider: 'openai' },
    );

    expect(result).toMatchObject({ preset: null, primary: 'keep' });
    expect(planNeedsGeneration(planQuickNoteActions(result))).toBe(false);
  });

  it('counts refused questions as level 0 / no and records the reason', () => {
    const refused = { reason: 'unsafe content', type: 'refusal' };
    const result = toQuickNoteRunDecision(
      emulated({
        delegate: refused,
        enrich: refused,
        explicitGoalRequest: { type: 'refusal' },
        keep: refused,
        link: refused,
        preset_discuss: refused,
        preset_goal: refused,
        preset_research: refused,
        preset_write_document: refused,
      }),
      { provider: 'openai' },
    );

    expect(result).toMatchObject({
      explicitGoalRequest: false,
      preset: null,
      primary: 'keep',
      refusals: {
        delegate: 'unsafe content',
        enrich: 'unsafe content',
        explicitGoalRequest: 'refused',
        keep: 'unsafe content',
        link: 'unsafe content',
        preset_discuss: 'unsafe content',
        preset_goal: 'unsafe content',
        preset_research: 'unsafe content',
        preset_write_document: 'unsafe content',
      },
      scores: { delegate: 0, enrich: 0, keep: 0, link: 0 },
    });
    expect(planQuickNoteActions(result)).toEqual({ enrich: false, link: false });
  });

  it('keeps answered questions when only some are refused', () => {
    const result = toQuickNoteRunDecision(
      emulated({
        delegate: score(4),
        enrich: { type: 'refusal' },
        keep: score(0),
        link: score(0),
        ...presets({ discuss: 1, goal: 0, research: 4, write_document: 0 }),
      }),
      { provider: 'openai' },
    );

    expect(result.refusals).toEqual({ enrich: 'refused' });
    expect(result).toMatchObject({ preset: 'research', primary: 'delegate' });
  });

  it('skips the goal preset for the next best one unless delegate is 4 or a comment asks', () => {
    const answers = (delegate: number) => ({
      delegate: score(delegate),
      enrich: score(0),
      keep: score(0),
      link: score(0),
      ...presets({ discuss: 1.2, goal: 2.4, research: 0.4, write_document: 0 }),
    });

    expect(toQuickNoteRunDecision(native(answers(3.2)), { provider: 'x' }).preset).toBe('discuss');
    expect(toQuickNoteRunDecision(native(answers(3.6)), { provider: 'x' }).preset).toBe('goal');
    expect(
      toQuickNoteRunDecision(
        native({
          ...answers(3.2),
          explicitGoalRequest: { probability: 0.5, type: 'boolean' },
        }),
        { provider: 'x' },
      ),
    ).toMatchObject({ explicitGoalRequest: true, preset: 'goal' });
    expect(
      toQuickNoteRunDecision(
        native({
          ...answers(3.2),
          explicitGoalRequest: { probability: 0.49, type: 'boolean' },
        }),
        { provider: 'x' },
      ),
    ).toMatchObject({ explicitGoalRequest: false, preset: 'discuss' });
  });

  it('falls back to the next best preset when an emulated goal is blocked', () => {
    // ROOT CAUSE:
    // Emulated decisions returned only the chosen preset, so when the Goal gate blocked a `goal`
    // pick (delegate 3, no comment) no other preset had a weight, the preset became null, and the
    // delegate Proposal was silently dropped.
    const result = toQuickNoteRunDecision(
      emulated({
        delegate: score(3),
        enrich: score(0),
        keep: score(0),
        link: score(0),
        ...presets({ discuss: 2, goal: 4, research: 3, write_document: 1 }),
      }),
      { provider: 'openai' },
    );

    expect(result).toMatchObject({
      preset: 'research',
      presetScores: { discuss: 2, goal: 4, research: 3, write_document: 1 },
    });
    expect(planQuickNoteActions(result).delegate).toEqual({
      autoApply: false,
      preset: 'research',
      score: 3,
    });
  });

  it('keeps an emulated goal when delegate is 4', () => {
    const result = toQuickNoteRunDecision(
      emulated({
        delegate: score(4),
        enrich: score(0),
        keep: score(0),
        link: score(0),
        ...presets({ discuss: 2, goal: 4, research: 3, write_document: 1 }),
      }),
      { provider: 'openai' },
    );

    expect(planQuickNoteActions(result).delegate).toMatchObject({ preset: 'goal' });
  });

  it('breaks preset ties by research, discuss, write_document, then goal', () => {
    const pick = (levels: Parameters<typeof presets>[0]) =>
      toQuickNoteRunDecision(
        emulated({
          delegate: score(4),
          enrich: score(0),
          keep: score(0),
          link: score(0),
          ...presets(levels),
        }),
        { provider: 'openai' },
      ).preset;

    expect(pick({ discuss: 3, goal: 3, research: 3, write_document: 3 })).toBe('research');
    expect(pick({ discuss: 3, goal: 3, research: 1, write_document: 3 })).toBe('discuss');
    expect(pick({ discuss: 0, goal: 3, research: 0, write_document: 3 })).toBe('write_document');
    expect(pick({ discuss: 0, goal: 0, research: 0, write_document: 0 })).toBe('research');
  });
});

describe('planQuickNoteActions', () => {
  it('keep-only judgements need no generation', () => {
    const plan = planQuickNoteActions(decision());
    expect(plan).toEqual({ enrich: false, link: false });
    expect(planNeedsGeneration(plan)).toBe(false);
  });

  it('gates enrich and link at their thresholds', () => {
    expect(
      planQuickNoteActions(decision({ scores: { delegate: 0, enrich: 2, keep: 1, link: 1 } })),
    ).toEqual({ enrich: true, link: false });
    expect(QUICK_NOTE_ACTION_THRESHOLDS.link).toBe(2);
  });

  it('proposes at delegate level 3 and auto-applies only at level 4', () => {
    const level3 = planQuickNoteActions(
      decision({ preset: 'research', scores: { delegate: 3, enrich: 0, keep: 0, link: 0 } }),
    );
    expect(level3.delegate).toEqual({ autoApply: false, preset: 'research', score: 3 });

    const level4 = planQuickNoteActions(
      decision({ preset: 'research', scores: { delegate: 4, enrich: 0, keep: 0, link: 0 } }),
    );
    expect(level4.delegate).toEqual({ autoApply: true, preset: 'research', score: 4 });

    expect(
      planQuickNoteActions(
        decision({ preset: 'research', scores: { delegate: 2, enrich: 0, keep: 0, link: 0 } }),
      ).delegate,
    ).toBeUndefined();
  });

  it.each([
    [3.49, false],
    [3.5, true],
  ])('a native delegate mean of %s auto-applies: %s', (mean, autoApply) => {
    const result = toQuickNoteRunDecision(
      native({
        delegate: score(mean),
        enrich: score(0),
        keep: score(0),
        link: score(0),
        ...presets({ research: 4 }),
      }),
      { provider: 'openrouter' },
    );
    expect(planQuickNoteActions(result).delegate).toMatchObject({
      autoApply,
      preset: 'research',
    });
  });

  it('drops a stored goal preset that is no longer allowed', () => {
    expect(
      planQuickNoteActions(
        decision({ preset: 'goal', scores: { delegate: 3, enrich: 0, keep: 0, link: 0 } }),
      ).delegate,
    ).toBeUndefined();
    expect(
      planQuickNoteActions(
        decision({
          explicitGoalRequest: true,
          preset: 'goal',
          scores: { delegate: 3, enrich: 0, keep: 0, link: 0 },
        }),
      ).delegate,
    ).toEqual({ autoApply: false, preset: 'goal', score: 3 });
  });
});

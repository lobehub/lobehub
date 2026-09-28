import { GOAL_CLARIFICATION_TITLE } from '@lobechat/const/goal';
import type { GoalGraphDecision, GoalGraphNode, GoalGraphSnapshot } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  clarificationOptions,
  collectClarificationAnswers,
  hasAskedClarification,
  normalizeUnderstanding,
} from './understanding';

const question = (overrides: Partial<Record<string, unknown>> = {}) => ({
  assumption: 'Target the web app',
  blocking: true,
  impact: 'Decides which client gets built',
  options: ['Web', 'Desktop'],
  question: 'Which client should this ship on?',
  ...overrides,
});

describe('normalizeUnderstanding', () => {
  it('asks the blocking questions and rates the understanding low', () => {
    const result = normalizeUnderstanding(
      {
        assumptions: [],
        questions: [question(), question({ blocking: false, assumption: 'CSV' })],
      },
      false,
    );

    expect(result.level).toBe('low');
    expect(result.ask).toEqual([
      {
        assumption: 'Target the web app',
        impact: 'Decides which client gets built',
        options: ['Web', 'Desktop'],
        question: 'Which client should this ship on?',
      },
    ]);
    // The question that is not asked still shapes the plan as a visible assumption.
    expect(result.assumptions).toEqual(['CSV']);
  });

  it('never asks twice: a re-plan turns its questions into assumptions', () => {
    const result = normalizeUnderstanding(
      { assumptions: ['Use English'], questions: [question()] },
      true,
    );

    expect(result.ask).toEqual([]);
    expect(result.level).toBe('medium');
    expect(result.assumptions).toEqual(['Use English', 'Target the web app']);
  });

  it('drops a re-asked question the user already answered instead of assuming against it', () => {
    const result = normalizeUnderstanding(
      {
        assumptions: ['Use English'],
        questions: [question(), question({ assumption: 'CSV', question: 'Which format?' })],
      },
      true,
      [' which client should this ship on? '],
    );

    expect(result.assumptions).toEqual(['Use English', 'CSV']);
  });

  it('rates a goal with nothing unknown high', () => {
    expect(normalizeUnderstanding({ assumptions: [], questions: [] }, false)).toEqual({
      ask: [],
      assumptions: [],
      level: 'high',
    });
    // An answer from before the fields existed plans as a clear goal.
    expect(normalizeUnderstanding({}, false).level).toBe('high');
  });

  it('caps the questions and drops blank ones', () => {
    const result = normalizeUnderstanding(
      {
        questions: [
          question({ question: '  ' }),
          question({ question: 'Q1' }),
          question({ question: 'Q2' }),
          question({ question: 'Q3' }),
          question({ question: 'Q4' }),
        ],
      },
      false,
    );

    expect(result.ask.map((item) => item.question)).toEqual(['Q1', 'Q2', 'Q3']);
  });
});

const node = (overrides: Partial<GoalGraphNode>): GoalGraphNode =>
  ({
    confidence: null,
    createdAt: new Date(0),
    description: null,
    goalId: 'goal',
    id: 'node',
    kind: 'decision',
    priority: 0,
    resolvedAt: null,
    status: 'resolved',
    taskId: null,
    title: GOAL_CLARIFICATION_TITLE,
    updatedAt: new Date(0),
    ...overrides,
  }) as GoalGraphNode;

const decision = (overrides: Partial<GoalGraphDecision>): GoalGraphDecision =>
  ({
    authority: 'user',
    canceledAt: null,
    createdAt: new Date(0),
    id: 'decision',
    nodeId: 'node',
    options: clarificationOptions({
      assumption: 'Target the web app',
      options: ['Web', 'Desktop'],
      question: 'Which client?',
    }),
    question: 'Which client?',
    recommendedOptionId: null,
    requestedProjectRole: null,
    requestedUserId: null,
    resolution: null,
    resolvedAt: new Date(0),
    resolvedByAgentId: null,
    resolvedByUserId: 'user',
    resolvedOptionId: 'option-2',
    status: 'resolved',
    updatedAt: new Date(0),
    ...overrides,
  }) as GoalGraphDecision;

const graphOf = (nodes: GoalGraphNode[], decisions: GoalGraphDecision[]) =>
  ({ decisions, nodes }) as unknown as GoalGraphSnapshot;

describe('collectClarificationAnswers', () => {
  it('reads each kind of answer back as the planner should see it', () => {
    const graph = graphOf(
      [node({ id: 'n1' }), node({ id: 'n2' }), node({ id: 'n3' }), node({ id: 'n4' })],
      [
        decision({ id: 'd1', nodeId: 'n1', resolvedOptionId: 'option-2' }),
        decision({
          id: 'd2',
          nodeId: 'n2',
          resolution: 'Only macOS',
          resolvedOptionId: 'option-2',
        }),
        decision({ id: 'd3', nodeId: 'n3', resolvedOptionId: 'assume' }),
        decision({ id: 'd4', nodeId: 'n4', resolution: 'Ship both', resolvedOptionId: 'answer' }),
      ],
    );

    expect(collectClarificationAnswers(graph).map((item) => item.answer)).toEqual([
      'Desktop',
      'Desktop (Only macOS)',
      'No preference — proceed with: Target the web app',
      'Ship both',
    ]);
  });

  it('ignores pending and non-clarification decisions', () => {
    const graph = graphOf(
      [node({ id: 'n1' }), node({ id: 'n2', title: 'Choose how to recover failed task' })],
      [
        decision({ nodeId: 'n1', resolvedOptionId: null, status: 'pending' }),
        decision({ nodeId: 'n2', resolvedOptionId: 'retry' }),
      ],
    );

    expect(collectClarificationAnswers(graph)).toEqual([]);
    expect(hasAskedClarification(graph)).toBe(true);
    expect(hasAskedClarification(graphOf([node({ title: 'Other' })], []))).toBe(false);
  });
});

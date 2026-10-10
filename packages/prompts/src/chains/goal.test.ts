import { describe, expect, it } from 'vitest';

import {
  chainGoalCriteriaDraft,
  chainGoalDecompose,
  GOAL_CRITERIA_DRAFT_JSON_SCHEMA,
  GOAL_CRITERIA_DRAFT_PROMPT_VERSION,
  GOAL_DECOMPOSE_JSON_SCHEMA,
  GOAL_DECOMPOSE_PROMPT_VERSION,
} from './goal';

describe('chainGoalCriteriaDraft', () => {
  it('owns a dedicated version, schema, and standing-goal prompt', () => {
    const chain = chainGoalCriteriaDraft({
      context: 'Goal: Release the product',
      goal: 'Ship a polished v1',
      maxCriteria: 6,
    });

    expect(GOAL_CRITERIA_DRAFT_PROMPT_VERSION).toBe('v3');
    expect(GOAL_CRITERIA_DRAFT_JSON_SCHEMA.name).toBe('goal_criteria_draft');
    expect(chain.messages[0].content).toContain('persistent autonomous goal');
    expect(chain.messages[0].content).toContain('at most 6 criteria');
    expect(chain.messages[0].content).toContain(
      'top-level instruction is a complete, actionable task brief',
    );
    expect(chain.messages[0].content).toContain(
      'criteria[].instruction is the exact, detailed judging rubric',
    );
    expect(chain.messages[0].content).toContain('Preserve every explicit numeric threshold');
    expect(chain.messages[0].content).toContain('do not invent an arbitrary one');
    expect(GOAL_CRITERIA_DRAFT_JSON_SCHEMA.schema.required).toEqual([
      'title',
      'instruction',
      'criteria',
    ]);
    expect(chain.messages[1].content).toContain('Ship a polished v1');
  });
});

describe('chainGoalDecompose', () => {
  it('aligns investigation and implementation responsibilities with their own pass conditions', () => {
    const requirement = '升级 PPT、Word、Excel 编辑体验，支持编辑、保存和重开。';
    const { messages } = chainGoalDecompose({ requirement });
    const prompt = messages[0].content;

    expect(GOAL_DECOMPOSE_PROMPT_VERSION).toBe('v8');
    expect(messages[1].content).toContain(requirement);
    expect(prompt).toContain('a request to build, fix, or upgrade requires implementation');
    expect(prompt).toContain('It may pass when it proves a capability is missing');
    expect(prompt).toContain(
      'assign explicit implementation ownership for every requested capability',
    );
    expect(prompt).toContain('include dependent implementation tasks that consume its findings');
    expect(prompt).toContain('discovering a read-only viewer triggers implementation');
    expect(prompt).toContain('an investigation-only goal must not become an implementation task');
  });

  it('flags one repeated mould with a probe spec and a full roster', () => {
    const { messages } = chainGoalDecompose({ requirement: '迁移 50 个同构的 store' });
    const prompt = messages[0].content;

    // R2: the homogeneity filter the planner must apply before claiming a batch.
    expect(prompt).toContain('after replacing the concrete file / module / symbol names');
    // Probe-only tasks plus the full roster the coordinator promotes from.
    expect(prompt).toContain('3–5 probes');
    expect(prompt).toContain('full roster of every homogeneous unit');
    expect(prompt).toContain('leave rollout null');

    const rollout = (GOAL_DECOMPOSE_JSON_SCHEMA.schema.properties as any).rollout;
    expect(rollout).toBeDefined();
    expect(rollout.properties.units).toBeDefined();
    expect(rollout.properties.repeatable).toBeDefined();
  });

  it('reports what it cannot determine and plans on answered clarifications', () => {
    const plain = chainGoalDecompose({ requirement: '写一份发布说明' });
    expect(plain.messages[0].content).toContain(
      'every blocking question goes into that single round',
    );
    expect(plain.messages[1].content).not.toContain('Answered clarifications');

    const { messages } = chainGoalDecompose({
      clarifications: [{ answer: '开发者', question: '给谁看？' }],
      requirement: '写一份发布说明',
    });
    expect(messages[1].content).toContain('## Answered clarifications');
    expect(messages[1].content).toContain('- Q: 给谁看？\n  A: 开发者');
  });
});

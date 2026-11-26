import { describe, expect, it } from 'vitest';

import { learnedRulesClause, planSkillName, planUnitBrief } from './batchPlanSkill';

describe('planSkillName', () => {
  const batchNodeId = '2e351018-5b56-4e8d-b53a-41e2b418d58a';

  it("uses the planner's name, slugged into a valid skill name", () => {
    expect(planSkillName({ batchNodeId, name: 'Migrate store reads to Replica' })).toBe(
      'migrate-store-reads-to-replica',
    );
  });

  /**
   * Regression: the plan skill was named after the batch id
   * (`goal-plan-2e351018`), which says nothing in the library or in a unit's
   * brief about what the plan does.
   */
  it('falls back to the words of the goal title rather than the batch id', () => {
    expect(
      planSkillName({ batchNodeId, goalTitle: '客户端读取全量迁移到 replica（STAMP v2）' }),
    ).toBe('replica-stamp-v2-plan');
  });

  it('cuts a long name at a word', () => {
    const name = planSkillName({ batchNodeId, name: 'word '.repeat(20) });
    expect(name.length).toBeLessThanOrEqual(48);
    expect(name).toMatch(/^word(-word)*$/);
  });

  it('keeps the batch id only when nothing reads as words', () => {
    expect(planSkillName({ batchNodeId, goalTitle: '首页迁移', name: 'v2' })).toBe(
      'goal-plan-2e351018',
    );
    expect(planSkillName({ batchNodeId: 'gnd_AbC123xyz' })).toBe('goal-plan-gndabc12');
  });
});

describe('planUnitBrief', () => {
  it('names the plan skill and keeps the plan at dispatch as a fallback', () => {
    const brief = planUnitBrief('Unit 3', {
      outline: 'Swap the store for replica',
      skill: { id: 'docs_1', name: 'goal-plan-x' },
    });
    expect(brief).toContain('Unit: Unit 3');
    expect(brief).toContain('`user-skills:goal-plan-x`');
    // A run that cannot load the skill still has the plan to work from.
    expect(brief).toContain('If that skill is not loaded in this run');
    expect(brief).toContain('Swap the store for replica');
  });

  it('copies the plan when the batch has no skill', () => {
    expect(planUnitBrief('Unit 3', { outline: 'Swap the store' })).toBe(
      'Swap the store\n\nUnit: Unit 3',
    );
  });
});

describe('learnedRulesClause', () => {
  it('carries every rule in full, not its truncated title', () => {
    const rule = `${'先确认 generation_batches 已在 replica 建表，'.repeat(4)}最后补一条回滚脚本`;
    const clause = learnedRulesClause([{ rule, title: `${rule.slice(0, 79)}…` }]);
    expect(clause).toContain(`- ${rule}`);
    expect(clause).toContain('最后补一条回滚脚本');
  });

  it('falls back to the title for a rule recorded before the full text was kept', () => {
    expect(learnedRulesClause([{ title: 'Seed SSR first' }])).toContain('- Seed SSR first');
    expect(learnedRulesClause([])).toBeUndefined();
  });
});

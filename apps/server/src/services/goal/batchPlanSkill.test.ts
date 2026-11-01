import { describe, expect, it } from 'vitest';

import { learnedRulesClause, planSkillName, planUnitBrief } from './batchPlanSkill';

describe('planSkillName', () => {
  it('turns a node id into a short, valid skill name', () => {
    expect(planSkillName('13b47c2a-5b56-4e8d-b53a-41e2b418d58a')).toBe('goal-plan-13b47c2a');
    expect(planSkillName('gnd_AbC123xyz')).toBe('goal-plan-gndabc12');
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

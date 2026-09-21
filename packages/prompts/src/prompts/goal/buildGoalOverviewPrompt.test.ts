import { describe, expect, it } from 'vitest';

import { buildGoalOverviewPrompt } from './buildGoalOverviewPrompt';

describe('buildGoalOverviewPrompt', () => {
  it('renders goal, tasks, findings and pending decisions', () => {
    const prompt = buildGoalOverviewPrompt({
      findings: ['Local run boots end to end'],
      goal: {
        requirement: 'Reproduce the paper locally',
        status: 'running',
        title: 'WikiSkill 本地完整复现',
      },
      pendingDecisions: [{ question: 'Use the small model for the ablation?' }],
      tasks: [
        { seq: 1, status: 'resolved', title: '项目骨架与本地运行基座' },
        { attempts: 2, seq: 2, status: 'active', title: '经验编译与技能演化闭环' },
      ],
    });

    expect(prompt).toContain('<goal_overview>');
    expect(prompt).toContain('Goal: WikiSkill 本地完整复现 [running]');
    expect(prompt).toContain('Requirement: Reproduce the paper locally');
    expect(prompt).toContain('#1 [resolved] 项目骨架与本地运行基座');
    expect(prompt).toContain('#2 [active] 经验编译与技能演化闭环  (attempt 2)');
    expect(prompt).toContain('- Local run boots end to end');
    expect(prompt).toContain('- Use the small model for the ablation?');
    expect(prompt).toContain('</goal_overview>');
  });

  it('omits empty sections', () => {
    const prompt = buildGoalOverviewPrompt({
      findings: [],
      goal: { status: 'pending', title: 'Goal' },
      pendingDecisions: [],
      tasks: [],
    });

    expect(prompt).not.toContain('Findings');
    expect(prompt).not.toContain('Pending decisions');
    expect(prompt).not.toContain('Requirement:');
  });
});

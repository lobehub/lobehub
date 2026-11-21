import { describe, expect, it } from 'vitest';

import { goalPlanSchema } from './manager';

const file = (path: string, content = 'x') => ({ content, path });

describe('plan package in the main Agent plans', () => {
  it('lets a batch declaration ship files with its recipe', () => {
    const plan = goalPlanSchema.parse({
      action: 'tasks',
      reason: 'one mould',
      rollout: {
        files: [file('scripts/check-pr.sh', 'gh pr checks')],
        recipe: 'swap the store',
        units: ['U3', 'U4'],
      },
      tasks: [
        { description: 'probe 1', title: 'U1' },
        { description: 'probe 2', title: 'U2' },
      ],
    });
    expect(plan.action === 'tasks' && plan.rollout?.files).toEqual([
      file('scripts/check-pr.sh', 'gh pr checks'),
    ]);
  });

  it('lets a rewrite add, replace and drop package files', () => {
    const plan = goalPlanSchema.parse({
      action: 'revise_plan',
      files: [file('scripts/check-pr.sh', 'v2')],
      reason: 'stricter gate',
      recipe: 'swap the store; pass review and CI',
      removeFiles: ['references/old.md'],
    });
    expect(plan).toMatchObject({
      files: [file('scripts/check-pr.sh', 'v2')],
      removeFiles: ['references/old.md'],
    });
  });
});

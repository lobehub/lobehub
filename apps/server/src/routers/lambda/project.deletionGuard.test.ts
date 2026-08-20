// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./project.ts', import.meta.url), 'utf8');

describe('project coordinator deletion guard wiring', () => {
  it('passes the business deletion guard into the Project transaction', () => {
    expect(source).toContain(
      'assertAgentDeletionAllowed({ agentId, executor, userId: ctx.userId })',
    );
    expect(source).toContain('await ctx.projectModel.delete(input.id,');
  });
});

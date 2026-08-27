// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Collapsed to single-spaced text so the assertions survive a Prettier reflow:
// the call below is wrapped across several lines whenever its argument list
// grows, and matching the raw source would fail on formatting alone.
const source = readFileSync(new URL('./project.ts', import.meta.url), 'utf8').replaceAll(
  /\s+/g,
  ' ',
);

describe('project coordinator deletion guard wiring', () => {
  it('passes the business deletion guard into the Project transaction', () => {
    expect(source).toContain(
      'assertAgentDeletionAllowed({ agentId, executor, userId: ctx.userId })',
    );
    expect(source).toContain('await ctx.projectModel.delete( input.id,');
  });
});

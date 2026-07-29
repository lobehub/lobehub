import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parse } from 'yaml';

describe('Claude issue dedupe workflow', () => {
  it('keeps the dedupe preflight independent from the MCP submission handler executor', async () => {
    const source = await readFile(
      resolve(process.cwd(), '.github/scripts/should-run-dedupe.ts'),
      'utf8',
    );

    expect(source).toContain('./shared/mcp-submission-classifier');
    expect(source).not.toContain('./auto-handle-mcp-submission');
  });

  it('runs Claude only after the deterministic dedupe preflight approves the issue', async () => {
    const workflow = parse(
      await readFile(resolve(process.cwd(), '.github/workflows/claude-dedupe-issues.yml'), 'utf8'),
    );

    const steps = workflow.jobs['claude-dedupe-issues'].steps;
    const preflightStep = steps.find(
      (step: Record<string, unknown>) => step.name === 'Check whether issue should be deduped',
    );
    const claudeStep = steps.find(
      (step: Record<string, unknown>) => step.name === 'Run Claude Code slash command',
    );

    expect(preflightStep).toMatchObject({
      id: 'dedupe-preflight',
    });
    expect(preflightStep.run).toContain('bun run .github/scripts/should-run-dedupe.ts');
    expect(claudeStep.if).toContain("steps.dedupe-preflight.outputs.should_dedupe == 'true'");
  });
});

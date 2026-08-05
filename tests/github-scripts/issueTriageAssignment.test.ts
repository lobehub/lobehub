import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('Claude issue triage assignment', () => {
  it('routes MCP marketplace listing requests to AmAzing129 instead of arvinxx', async () => {
    const guide = await readFile(
      resolve(process.cwd(), '.claude/prompts/team-assignment.md'),
      'utf8',
    );

    expect(guide).toContain('MCP marketplace listing/submission requests — @AmAzing129');
    expect(guide).not.toContain('MCP marketplace listing/submission requests — do NOT mention');
  });

  it('does not keep MCP marketplace submissions as a no-mention example in the workflow', async () => {
    const workflow = await readFile(
      resolve(process.cwd(), '.github/workflows/claude-issue-triage.yml'),
      'utf8',
    );

    expect(workflow).not.toContain('e.g. MCP marketplace listing/submission requests');
  });
});

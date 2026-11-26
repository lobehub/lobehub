import { describe, expect, it } from 'vitest';

import { resolveProjectDirectoryRun } from './resolveProjectDirectoryRun';

const run = (
  staged: Parameters<typeof resolveProjectDirectoryRun>[0]['staged'],
  agencyConfig = {},
) =>
  resolveProjectDirectoryRun({
    agencyConfig: { boundDeviceId: 'dev-1', executionTarget: 'device', ...agencyConfig },
    boundDirectoryId: undefined,
    isGatewayMode: true,
    staged,
  });

describe('resolveProjectDirectoryRun — project-only drafts', () => {
  // Review: Auto's sandbox used to rewrite the agent's own target through the
  // persistent setting, outliving the draft.
  it('runs an Auto sandbox draft in the sandbox for this send only', async () => {
    const result = await run({ agentId: 'agt', auto: true, projectId: 'prj' });

    expect(result.agencyConfig?.executionTarget).toBe('sandbox');
    expect(result.newTopicProject).toEqual({ projectId: 'prj' });
  });

  it("leaves a hand-picked project draft on the agent's own target", async () => {
    const result = await run({ agentId: 'agt', projectId: 'prj' });

    expect(result.agencyConfig?.executionTarget).toBe('device');
  });

  it('does not override an agent fixed to its target', async () => {
    const result = await run(
      { agentId: 'agt', auto: true, projectId: 'prj' },
      { executionTargetSelectionPolicy: 'fixed' },
    );

    expect(result.agencyConfig?.executionTarget).toBe('device');
  });
});

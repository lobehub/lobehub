import { describe, expect, it } from 'vitest';

import { projectFallsBackToSandbox, withProjectSandboxFallback } from './projectOwnDevice';

const claudeCode = {
  boundDeviceId: 'dev-1',
  executionTarget: 'device' as const,
  heterogeneousProvider: { type: 'claude-code' as const },
};
const base = {
  agencyConfig: claudeCode,
  boundDeviceId: undefined,
  interactive: true,
  projectId: 'prj',
  requestedDeviceId: undefined,
};

describe('projectFallsBackToSandbox', () => {
  it('runs a project conversation without a directory of a Claude Code agent in the sandbox', () => {
    expect(projectFallsBackToSandbox(base)).toBe(true);
  });

  it('keeps a conversation already on a machine, or outside a project', () => {
    expect(projectFallsBackToSandbox({ ...base, boundDeviceId: 'dev-1' })).toBe(false);
    expect(projectFallsBackToSandbox({ ...base, requestedDeviceId: 'dev-2' })).toBe(false);
    expect(projectFallsBackToSandbox({ ...base, projectId: undefined })).toBe(false);
  });

  it('leaves tasks, device-only providers and regular agents on their own target', () => {
    expect(projectFallsBackToSandbox({ ...base, interactive: false })).toBe(false);
    expect(
      projectFallsBackToSandbox({
        ...base,
        agencyConfig: { ...claudeCode, heterogeneousProvider: { type: 'cursor' as const } },
      }),
    ).toBe(false);
    expect(
      projectFallsBackToSandbox({
        ...base,
        agencyConfig: { boundDeviceId: 'dev-1', executionTarget: 'device' },
      }),
    ).toBe(false);
  });
});

describe('withProjectSandboxFallback', () => {
  const turn = { boundDeviceId: undefined, projectId: 'prj' };

  it('moves a composer turn to the sandbox and keeps a task on its device', () => {
    expect(withProjectSandboxFallback(claudeCode, {}, turn)?.executionTarget).toBe('sandbox');
    expect(
      withProjectSandboxFallback(claudeCode, { operationTaskId: 'task' }, turn)?.executionTarget,
    ).toBe('device');
  });
});

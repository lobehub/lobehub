import { describe, expect, it } from 'vitest';

import { pickSandboxPlacement } from './sandboxPlacement';

describe('pickSandboxPlacement', () => {
  it('carries the folder or the environment directory the composer chose', () => {
    expect(pickSandboxPlacement({ sandboxWorkingDirectory: 'reports' })).toEqual({
      sandboxWorkingDirectory: 'reports',
    });
    expect(pickSandboxPlacement({ sandboxInstanceId: 'inst-1' })).toEqual({
      sandboxInstanceId: 'inst-1',
    });
  });

  it('carries the drive the folder is on', () => {
    expect(
      pickSandboxPlacement({ sandboxDrive: 'personal', sandboxWorkingDirectory: 'notes' }),
    ).toEqual({ sandboxDrive: 'personal', sandboxWorkingDirectory: 'notes' });
  });

  // A project conversation decides from these whether its environment applies.
  it('carries whether the placement is a default or a temporary sandbox picked on purpose', () => {
    expect(pickSandboxPlacement({ sandboxEnvironmentId: 'env-1', sandboxSeeded: true })).toEqual({
      sandboxEnvironmentId: 'env-1',
      sandboxSeeded: true,
    });
    expect(pickSandboxPlacement({ sandboxTemporary: true })).toEqual({ sandboxTemporary: true });
  });

  it('carries nothing for a conversation that chose nothing', () => {
    expect(pickSandboxPlacement(undefined)).toEqual({});
    expect(pickSandboxPlacement({})).toEqual({});
  });
});

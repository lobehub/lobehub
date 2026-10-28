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

  it('carries nothing for a conversation that chose nothing', () => {
    expect(pickSandboxPlacement(undefined)).toEqual({});
    expect(pickSandboxPlacement({})).toEqual({});
  });
});

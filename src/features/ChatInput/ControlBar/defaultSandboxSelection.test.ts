import { describe, expect, it } from 'vitest';

import { resolveDefaultSandboxSelection } from './defaultSandboxSelection';

describe('resolveDefaultSandboxSelection', () => {
  it('starts a personal account at the root of its own drive', () => {
    expect(resolveDefaultSandboxSelection()).toEqual({ workingDirectory: '.' });
    expect(resolveDefaultSandboxSelection(null)).toEqual({ workingDirectory: '.' });
  });

  // The public drive's root is refused as a working directory, so every agent
  // in a workspace — shared or not — starts on the member's own drive.
  it("starts a workspace run at the root of the member's personal drive", () => {
    expect(resolveDefaultSandboxSelection('ws_1')).toEqual({
      drive: 'personal',
      workingDirectory: '.',
    });
  });
});

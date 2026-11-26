import { describe, expect, it } from 'vitest';

import { dispatchedModeSpawnOptions } from './dispatchedModes';

describe('dispatchedModeSpawnOptions', () => {
  it('gives each agent only its own mode', () => {
    const resolved = { collaborationMode: 'plan' as const, permissionMode: 'plan' as const };
    expect(dispatchedModeSpawnOptions('codex', resolved)).toEqual({ collaborationMode: 'plan' });
    expect(dispatchedModeSpawnOptions('claude-code', resolved)).toEqual({ permissionMode: 'plan' });
    expect(dispatchedModeSpawnOptions('cursor', resolved)).toEqual({});
  });
});

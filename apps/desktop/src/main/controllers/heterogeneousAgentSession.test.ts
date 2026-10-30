import { describe, expect, it } from 'vitest';

import { claudeProfileDirOf } from './heterogeneousAgentSession';

describe('claudeProfileDirOf', () => {
  it('follows a profile the session env picked, e.g. a routed account', () => {
    // Resume recovery used to read only the hosted binding, so a rebuilt
    // transcript for a routed account landed where `--resume` never looks.
    expect(claudeProfileDirOf({ env: { CLAUDE_CONFIG_DIR: '/profiles/work' } })).toBe(
      '/profiles/work',
    );
  });

  it('falls back to the hosted binding profile, then the default ~/.claude', () => {
    expect(
      claudeProfileDirOf({ hostedProviderBinding: { profileDir: '/bindings/x' } as never }),
    ).toBe('/bindings/x');
    expect(claudeProfileDirOf({})).toBeUndefined();
  });
});

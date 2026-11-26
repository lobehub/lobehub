import { describe, expect, it } from 'vitest';

import { resolveShareDefaultProviders } from './shareDefaultProviders';

const shareProviders = ['lobehub'];
const base = { shareProviders, supported: true, usesWorkspaceMemberSelection: false };

describe('resolveShareDefaultProviders', () => {
  it('restricts the carried-over default of a live share', () => {
    expect(resolveShareDefaultProviders({ ...base, isShared: true })).toBe(shareProviders);
  });

  // Cold load: the share status has not arrived yet, and the agent may be shared.
  it('restricts while the share status is still loading', () => {
    expect(resolveShareDefaultProviders({ ...base, isShared: undefined })).toBe(shareProviders);
  });

  it('lifts the restriction once the agent is known not to be shared', () => {
    expect(resolveShareDefaultProviders({ ...base, isShared: false })).toBeUndefined();
  });

  it("does not restrict a member's own override, which no share checks", () => {
    expect(
      resolveShareDefaultProviders({ ...base, isShared: true, usesWorkspaceMemberSelection: true }),
    ).toBeUndefined();
  });

  it('does not restrict when sharing is unsupported or the agent is exempt', () => {
    expect(resolveShareDefaultProviders({ ...base, supported: false })).toBeUndefined();
    expect(
      resolveShareDefaultProviders({ ...base, isShared: true, shareProviders: undefined }),
    ).toBeUndefined();
  });
});

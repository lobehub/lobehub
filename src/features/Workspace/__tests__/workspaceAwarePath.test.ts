import { describe, expect, it } from 'vitest';

import { buildWorkspaceAwarePath } from '../workspaceAwarePath';

describe('buildWorkspaceAwarePath', () => {
  it('returns the path unchanged when no active workspace slug exists', () => {
    expect(buildWorkspaceAwarePath('/memory', null)).toBe('/memory');
    expect(buildWorkspaceAwarePath('/memory', undefined)).toBe('/memory');
  });

  it('prefixes absolute paths with the active workspace slug', () => {
    expect(buildWorkspaceAwarePath('/memory', 'acme')).toBe('/acme/memory');
    expect(buildWorkspaceAwarePath('/agent/inbox', 'acme')).toBe('/acme/agent/inbox');
    expect(buildWorkspaceAwarePath('/image?model=image-model', 'acme')).toBe(
      '/acme/image?model=image-model',
    );
    expect(buildWorkspaceAwarePath('/video?model=video-model', 'acme')).toBe(
      '/acme/video?model=video-model',
    );
    expect(buildWorkspaceAwarePath('/community/agent/jailbreak', 'acme')).toBe(
      '/acme/community/agent/jailbreak',
    );
    expect(buildWorkspaceAwarePath('/group/group-1', 'acme')).toBe('/acme/group/group-1');
  });

  it('prefixes deep agent and evaluation paths used by cross-page navigation', () => {
    expect(buildWorkspaceAwarePath('/agent/agent-1/profile', 'acme')).toBe(
      '/acme/agent/agent-1/profile',
    );
    expect(buildWorkspaceAwarePath('/agent/agent-1/topic-1', 'acme')).toBe(
      '/acme/agent/agent-1/topic-1',
    );
    expect(buildWorkspaceAwarePath('/eval/bench/bench-1/runs/run-1/cases/case-1', 'acme')).toBe(
      '/acme/eval/bench/bench-1/runs/run-1/cases/case-1',
    );
  });

  it('bypasses the prefix when `escape` is true', () => {
    expect(buildWorkspaceAwarePath('/settings/profile', 'acme', { escape: true })).toBe(
      '/settings/profile',
    );
    expect(buildWorkspaceAwarePath('/settings/plans', 'acme', { escape: true })).toBe(
      '/settings/plans',
    );
  });

  it('does not double-prefix when the path is already under the active slug', () => {
    expect(buildWorkspaceAwarePath('/acme', 'acme')).toBe('/acme');
    expect(buildWorkspaceAwarePath('/acme/memory', 'acme')).toBe('/acme/memory');
  });

  it('does not prefix paths already qualified by another workspace slug', () => {
    expect(buildWorkspaceAwarePath('/test-team/agent/agent-1', 'acme')).toBe(
      '/test-team/agent/agent-1',
    );
    expect(buildWorkspaceAwarePath('/test-team/settings/general', 'acme')).toBe(
      '/test-team/settings/general',
    );
  });

  it('leaves relative paths alone (router resolves them)', () => {
    expect(buildWorkspaceAwarePath('memory', 'acme')).toBe('memory');
    expect(buildWorkspaceAwarePath('../tasks', 'acme')).toBe('../tasks');
  });

  it('skips prefix for personal-only top-level paths', () => {
    expect(buildWorkspaceAwarePath('/onboarding/agent', 'acme')).toBe('/onboarding/agent');
    expect(buildWorkspaceAwarePath('/me/profile', 'acme')).toBe('/me/profile');
    expect(buildWorkspaceAwarePath('/share/t/foo', 'acme')).toBe('/share/t/foo');
    expect(buildWorkspaceAwarePath('/devtools', 'acme')).toBe('/devtools');
    // Workspace invite acceptance is a standalone root-level page (no
    // `/:workspaceSlug` mirror), so notifications linking to it must not be
    // prefixed while the recipient sits inside another workspace.
    expect(buildWorkspaceAwarePath('/invite/tok-123', 'acme')).toBe('/invite/tok-123');
  });

  it('prefixes settings sub-paths that have a workspace mirror', () => {
    expect(buildWorkspaceAwarePath('/settings/general', 'acme')).toBe('/acme/settings/general');
    expect(buildWorkspaceAwarePath('/settings/members', 'acme')).toBe('/acme/settings/members');
    expect(buildWorkspaceAwarePath('/settings/plans', 'acme')).toBe('/acme/settings/plans');
    expect(buildWorkspaceAwarePath('/settings/billing', 'acme')).toBe('/acme/settings/billing');
    expect(buildWorkspaceAwarePath('/settings/credits', 'acme')).toBe('/acme/settings/credits');
    expect(buildWorkspaceAwarePath('/settings/usage', 'acme')).toBe('/acme/settings/usage');
    expect(buildWorkspaceAwarePath('/settings/skill', 'acme')).toBe('/acme/settings/skill');
    expect(buildWorkspaceAwarePath('/settings/connector', 'acme')).toBe('/acme/settings/connector');
    expect(buildWorkspaceAwarePath('/settings/devices', 'acme')).toBe('/acme/settings/devices');
    expect(buildWorkspaceAwarePath('/settings/audit-log', 'acme')).toBe('/acme/settings/audit-log');
    expect(buildWorkspaceAwarePath('/settings/storage', 'acme')).toBe('/acme/settings/storage');
    expect(buildWorkspaceAwarePath('/settings/credential', 'acme')).toBe(
      '/acme/settings/credential',
    );
    // Legacy alias — prefixed, then the router redirects to `credential`.
    expect(buildWorkspaceAwarePath('/settings/creds', 'acme')).toBe('/acme/settings/creds');
    expect(buildWorkspaceAwarePath('/settings/oauth-apps', 'acme')).toBe(
      '/acme/settings/oauth-apps',
    );
    expect(buildWorkspaceAwarePath('/settings/oauth-apps/client-1', 'acme')).toBe(
      '/acme/settings/oauth-apps/client-1',
    );
    expect(buildWorkspaceAwarePath('/settings/provider/openai', 'acme')).toBe(
      '/acme/settings/provider/openai',
    );
  });

  it('skips prefix for personal-only settings sub-paths', () => {
    expect(buildWorkspaceAwarePath('/settings/profile', 'acme')).toBe('/settings/profile');
    expect(buildWorkspaceAwarePath('/settings/llm', 'acme')).toBe('/settings/llm');
    expect(buildWorkspaceAwarePath('/settings/memory', 'acme')).toBe('/settings/memory');
    expect(buildWorkspaceAwarePath('/settings/messenger', 'acme')).toBe('/settings/messenger');
    expect(buildWorkspaceAwarePath('/settings/referral', 'acme')).toBe('/settings/referral');
    expect(buildWorkspaceAwarePath('/settings/system-tools', 'acme')).toBe(
      '/settings/system-tools',
    );
  });

  it('prefixes the `/settings` index — both personal and workspace have a meaningful redirect', () => {
    expect(buildWorkspaceAwarePath('/settings', 'acme')).toBe('/acme/settings');
    expect(buildWorkspaceAwarePath('/settings/', 'acme')).toBe('/acme/settings/');
    expect(buildWorkspaceAwarePath('/settings?foo=bar', 'acme')).toBe('/acme/settings?foo=bar');
  });
});

import { describe, expect, it } from 'vitest';

import { canManageWorkspaceScm, sanitizeReturnTo } from '../scope';

describe('scm scope helpers', () => {
  it('lets members and above install, never viewers or non-members', () => {
    expect(canManageWorkspaceScm('owner')).toBe(true);
    expect(canManageWorkspaceScm('admin')).toBe(true);
    expect(canManageWorkspaceScm('member')).toBe(true);
    expect(canManageWorkspaceScm('viewer')).toBe(false);
    expect(canManageWorkspaceScm(undefined)).toBe(false);
  });

  it('keeps only same-origin paths as return destinations', () => {
    expect(sanitizeReturnTo('/settings/integrations/github')).toBe('/settings/integrations/github');
    expect(sanitizeReturnTo('https://evil.example/phish')).toBeUndefined();
    expect(sanitizeReturnTo('//evil.example/phish')).toBeUndefined();
    expect(sanitizeReturnTo('/\\evil.example')).toBeUndefined();
    expect(sanitizeReturnTo('settings')).toBeUndefined();
    expect(sanitizeReturnTo(null)).toBeUndefined();
  });
});

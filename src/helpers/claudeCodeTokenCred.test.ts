import { type UserCredSummary } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  canRemoveClaudeCodeToken,
  CLAUDE_CODE_TOKEN_CRED_KEY,
  resolveClaudeCodeTokenStatus,
} from './claudeCodeTokenCred';

const personalToken = (overrides: Partial<UserCredSummary> = {}): UserCredSummary =>
  ({
    createdAt: '2026-10-14T00:00:00.000Z',
    id: 7,
    key: CLAUDE_CODE_TOKEN_CRED_KEY,
    maskedPreview: 'sk-a****DgAA',
    name: 'Claude Code OAuth Token',
    type: 'kv-env',
    ...overrides,
  }) as UserCredSummary;

const contextToken = { key: CLAUDE_CODE_TOKEN_CRED_KEY, name: 'Claude Code OAuth Token' };

describe('resolveClaudeCodeTokenStatus', () => {
  it('shows the personal preview outside a workspace', () => {
    const cred = personalToken();

    expect(
      resolveClaudeCodeTokenStatus({
        contextCreds: [contextToken],
        inWorkspace: false,
        personalCreds: [cred],
      }),
    ).toEqual({ display: 'sk-a****DgAA', editable: true, status: 'configured' });
  });

  it('reports a personal token that is not shared to the active workspace', () => {
    const cred = personalToken();

    expect(
      resolveClaudeCodeTokenStatus({ contextCreds: [], inWorkspace: true, personalCreds: [cred] }),
    ).toEqual({ personalCred: cred, status: 'personalNotShared' });
  });

  it('shows the personal preview once the token is shared to the active workspace', () => {
    expect(
      resolveClaudeCodeTokenStatus({
        contextCreds: [{ ...contextToken, ownerType: 'user' }],
        inWorkspace: true,
        personalCreds: [personalToken({ sharedToActiveWorkspace: true })],
      }),
    ).toEqual({ display: 'sk-a****DgAA', editable: true, status: 'configured' });
  });

  it('does not show an unshared personal preview for a workspace-owned token', () => {
    expect(
      resolveClaudeCodeTokenStatus({
        contextCreds: [{ ...contextToken, name: 'Team token', ownerType: 'organization' }],
        inWorkspace: true,
        personalCreds: [personalToken()],
      }),
    ).toEqual({ display: 'Team token', editable: false, status: 'configured' });
  });

  it('cannot edit a workspace-owned token the caller has no personal copy of', () => {
    expect(
      resolveClaudeCodeTokenStatus({
        contextCreds: [{ ...contextToken, ownerType: 'organization' }],
        inWorkspace: true,
        personalCreds: [],
      }),
    ).toEqual({ display: 'Claude Code OAuth Token', editable: false, status: 'configured' });
  });

  it('is missing when no scope holds the token', () => {
    expect(
      resolveClaudeCodeTokenStatus({ contextCreds: [], inWorkspace: false, personalCreds: [] }),
    ).toEqual({ status: 'missing' });
  });
});

describe('canRemoveClaudeCodeToken', () => {
  it('allows removing the caller’s own configured token', () => {
    const status = resolveClaudeCodeTokenStatus({
      contextCreds: [contextToken],
      inWorkspace: false,
      personalCreds: [personalToken()],
    });

    expect(canRemoveClaudeCodeToken(status)).toBe(true);
  });

  it('allows removing an own token that is not shared to this workspace', () => {
    const status = resolveClaudeCodeTokenStatus({
      contextCreds: [],
      inWorkspace: true,
      personalCreds: [personalToken()],
    });

    expect(canRemoveClaudeCodeToken(status)).toBe(true);
  });

  it('does not allow removing a token owned by the workspace or another member', () => {
    const status = resolveClaudeCodeTokenStatus({
      contextCreds: [contextToken],
      inWorkspace: true,
      personalCreds: [],
    });

    expect(canRemoveClaudeCodeToken(status)).toBe(false);
    expect(canRemoveClaudeCodeToken({ status: 'missing' })).toBe(false);
    expect(canRemoveClaudeCodeToken({ status: 'unknown' })).toBe(false);
  });
});

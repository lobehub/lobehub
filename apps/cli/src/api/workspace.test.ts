import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveWorkspaceId, resolveWorkspaceScope, withWorkspaceHeader } from './workspace';

const { mockLoadActiveWorkspaceId } = vi.hoisted(() => ({
  mockLoadActiveWorkspaceId: vi.fn<() => string | undefined>(),
}));

vi.mock('../settings', () => ({ loadActiveWorkspaceId: mockLoadActiveWorkspaceId }));

describe('api/workspace scope resolution', () => {
  const originalWorkspaceId = process.env.LOBEHUB_WORKSPACE_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadActiveWorkspaceId.mockReturnValue(undefined);
    delete process.env.LOBEHUB_WORKSPACE_ID;
  });

  afterEach(() => {
    if (originalWorkspaceId === undefined) delete process.env.LOBEHUB_WORKSPACE_ID;
    else process.env.LOBEHUB_WORKSPACE_ID = originalWorkspaceId;
  });

  it('reports personal scope when nothing is configured', () => {
    expect(resolveWorkspaceScope()).toEqual({ source: 'personal' });
    expect(resolveWorkspaceId()).toBeUndefined();
  });

  it('falls back to the workspace persisted by `workspace use`', () => {
    mockLoadActiveWorkspaceId.mockReturnValue('ws_stored');

    expect(resolveWorkspaceScope()).toEqual({ source: 'settings', workspaceId: 'ws_stored' });
  });

  // A one-off invocation has to be able to override the machine-wide default
  // without rewriting it, so the env var wins over the persisted scope.
  it('prefers the env var over the persisted workspace', () => {
    process.env.LOBEHUB_WORKSPACE_ID = 'ws_env';
    mockLoadActiveWorkspaceId.mockReturnValue('ws_stored');

    expect(resolveWorkspaceScope()).toEqual({ source: 'env', workspaceId: 'ws_env' });
  });

  it('prefers an explicit argument over everything else', () => {
    process.env.LOBEHUB_WORKSPACE_ID = 'ws_env';
    mockLoadActiveWorkspaceId.mockReturnValue('ws_stored');

    expect(resolveWorkspaceScope('ws_explicit')).toEqual({
      source: 'explicit',
      workspaceId: 'ws_explicit',
    });
  });

  it('sends the persisted workspace as a header', () => {
    mockLoadActiveWorkspaceId.mockReturnValue('ws_stored');

    expect(withWorkspaceHeader({ 'Oidc-Auth': 'token' })).toEqual({
      'Oidc-Auth': 'token',
      'X-Workspace-Id': 'ws_stored',
    });
  });

  it('omits the header in personal scope', () => {
    expect(withWorkspaceHeader({ 'Oidc-Auth': 'token' })).toEqual({ 'Oidc-Auth': 'token' });
  });
});

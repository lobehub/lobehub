import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import {
  __resetStaleScopeWarning,
  resolveWorkspaceId,
  resolveWorkspaceScope,
  withWorkspaceHeader,
} from './workspace';

const { mockLoadActiveWorkspace, mockResolveIdentityFingerprint, mockResolveServerUrl } =
  vi.hoisted(() => ({
    mockLoadActiveWorkspace: vi.fn<() => Record<string, string> | undefined>(),
    mockResolveIdentityFingerprint: vi.fn<() => string | undefined>(),
    mockResolveServerUrl: vi.fn<() => string>(),
  }));

vi.mock('../settings', () => ({
  loadActiveWorkspace: mockLoadActiveWorkspace,
  resolveServerUrl: mockResolveServerUrl,
}));
vi.mock('../auth/identity', () => ({
  resolveIdentityFingerprint: mockResolveIdentityFingerprint,
}));

const SERVER = 'https://app.lobehub.com';
const stored = (overrides: Record<string, string> = {}) => ({
  identity: 'user:u1',
  serverUrl: SERVER,
  workspaceId: 'ws_stored',
  ...overrides,
});

describe('api/workspace scope resolution', () => {
  const originalWorkspaceId = process.env.LOBEHUB_WORKSPACE_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetStaleScopeWarning();
    mockLoadActiveWorkspace.mockReturnValue(undefined);
    mockResolveIdentityFingerprint.mockReturnValue('user:u1');
    mockResolveServerUrl.mockReturnValue(SERVER);
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

  it('uses the workspace persisted by `workspace use`', () => {
    mockLoadActiveWorkspace.mockReturnValue(stored());

    expect(resolveWorkspaceScope()).toEqual({ source: 'settings', workspaceId: 'ws_stored' });
  });

  // A one-off invocation has to be able to override the machine-wide default
  // without rewriting it, so the env var wins over the persisted scope.
  it('prefers the env var over the persisted workspace', () => {
    process.env.LOBEHUB_WORKSPACE_ID = 'ws_env';
    mockLoadActiveWorkspace.mockReturnValue(stored());

    expect(resolveWorkspaceScope()).toEqual({ source: 'env', workspaceId: 'ws_env' });
  });

  // A goal/task dispatch spawns `hetero exec` with an operation-scoped
  // LOBEHUB_JWT and states its scope solely through LOBEHUB_WORKSPACE_ID. The
  // machine's `workspace use` scope must not leak into that run: it FORBIDDENs
  // every ingest call of a personal-scope topic.
  it('ignores the persisted workspace when running under an injected LOBEHUB_JWT', () => {
    process.env.LOBEHUB_JWT = 'jwt-from-dispatch';
    mockLoadActiveWorkspace.mockReturnValue(stored());
    try {
      expect(resolveWorkspaceScope()).toEqual({ source: 'personal' });

      process.env.LOBEHUB_WORKSPACE_ID = 'ws_env';
      expect(resolveWorkspaceScope()).toEqual({ source: 'env', workspaceId: 'ws_env' });
    } finally {
      delete process.env.LOBEHUB_JWT;
    }
  });

  it('prefers an explicit argument over everything else', () => {
    process.env.LOBEHUB_WORKSPACE_ID = 'ws_env';
    mockLoadActiveWorkspace.mockReturnValue(stored());

    expect(resolveWorkspaceScope('ws_explicit')).toEqual({
      source: 'explicit',
      workspaceId: 'ws_explicit',
    });
  });

  // Cloud answers a workspace header the caller has no membership in by falling
  // back to personal scope, so a scope carried across an account or server
  // switch would silently write personal data while claiming to be scoped.
  describe('stale bindings', () => {
    it.each([
      ['the account changed', () => mockResolveIdentityFingerprint.mockReturnValue('user:u2')],
      ['the account is gone', () => mockResolveIdentityFingerprint.mockReturnValue(undefined)],
      [
        'the server changed',
        () => mockResolveServerUrl.mockReturnValue('https://self-hosted.example.com'),
      ],
    ])('drops the persisted scope when %s', (_label, arrange) => {
      mockLoadActiveWorkspace.mockReturnValue(stored());
      arrange();

      expect(resolveWorkspaceScope()).toEqual({ source: 'stale' });
      expect(withWorkspaceHeader({ 'Oidc-Auth': 'token' })).toEqual({ 'Oidc-Auth': 'token' });
    });

    // The reason is the whole value of the warning: "different account" and
    // "no account at all" need different fixes.
    it.each([
      [
        'names the other account',
        () => mockResolveIdentityFingerprint.mockReturnValue('user:u2'),
        'a different account',
      ],
      [
        'points API-key callers at the env var',
        () => mockResolveIdentityFingerprint.mockReturnValue(undefined),
        'LOBEHUB_WORKSPACE_ID',
      ],
      [
        'names the other server',
        () => mockResolveServerUrl.mockReturnValue('https://self-hosted.example.com'),
        'https://app.lobehub.com',
      ],
    ])('%s', (_label, arrange, expected) => {
      mockLoadActiveWorkspace.mockReturnValue(stored());
      arrange();

      resolveWorkspaceScope();

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining(expected));
    });

    it('warns at most once per process', () => {
      mockLoadActiveWorkspace.mockReturnValue(stored());
      mockResolveIdentityFingerprint.mockReturnValue('user:u2');

      resolveWorkspaceScope();
      resolveWorkspaceScope();

      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('ws_stored'));
    });
  });

  it('sends the persisted workspace as a header', () => {
    mockLoadActiveWorkspace.mockReturnValue(stored());

    expect(withWorkspaceHeader({ 'Oidc-Auth': 'token' })).toEqual({
      'Oidc-Auth': 'token',
      'X-Workspace-Id': 'ws_stored',
    });
  });

  it('omits the header in personal scope', () => {
    expect(withWorkspaceHeader({ 'Oidc-Auth': 'token' })).toEqual({ 'Oidc-Auth': 'token' });
  });
});

import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { __resetScopeFromFlag, resolveWorkspaceScope } from './workspace';
import {
  applyWorkspaceOverride,
  findWorkspace,
  listWorkspaces,
  resolveWorkspaceRef,
} from './workspaceRef';

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));

vi.mock('./client', () => ({
  getTrpcClient: async () => ({ workspace: { list: { query: mockList } } }),
}));

const trpcError = (code: string) =>
  new TRPCClientError(code, { result: { error: { data: { code } } } as never });

const workspaces = [
  { id: 'ws_1', name: 'Acme', slug: 'acme' },
  // A slug that collides with another workspace's id must not shadow that id.
  { id: 'ws_2', name: 'Beta', slug: 'ws_1' },
];

describe('workspaceRef', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue(workspaces);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
  });

  it('prefers an id match over a slug match', () => {
    expect(findWorkspace(workspaces, 'ws_1')?.name).toBe('Acme');
  });

  it('resolves a slug to its id', async () => {
    await expect(resolveWorkspaceRef('acme')).resolves.toBe('ws_1');
  });

  it('keeps an omitted value for the ambient scope without a lookup', async () => {
    await expect(resolveWorkspaceRef(undefined)).resolves.toBeUndefined();
    expect(mockList).not.toHaveBeenCalled();
  });

  // Credentials that cannot list workspaces keep the pre-slug behavior.
  it('passes the value through as an id when the lookup is forbidden', async () => {
    mockList.mockRejectedValue(trpcError('FORBIDDEN'));

    await expect(resolveWorkspaceRef('ws_x')).resolves.toBe('ws_x');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('pass the workspace id'));
  });

  // A slug forwarded after a transient failure would read the personal scope.
  it('fails when the lookup fails for any other reason', async () => {
    mockList.mockRejectedValue(trpcError('INTERNAL_SERVER_ERROR'));
    await expect(resolveWorkspaceRef('acme')).rejects.toThrow('INTERNAL_SERVER_ERROR');

    mockList.mockRejectedValue(new TypeError('fetch failed'));
    await expect(resolveWorkspaceRef('acme')).rejects.toThrow('fetch failed');
  });

  it('exits when nothing matches', async () => {
    await expect(resolveWorkspaceRef('nope')).rejects.toThrow('process.exit');
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('nope'));
  });

  describe('applyWorkspaceOverride', () => {
    const originalEnv = process.env.LOBEHUB_WORKSPACE_ID;
    const originalJwt = process.env.LOBEHUB_JWT;

    beforeEach(() => {
      __resetScopeFromFlag();
      delete process.env.LOBEHUB_WORKSPACE_ID;
      delete process.env.LOBEHUB_JWT;
    });

    afterEach(() => {
      __resetScopeFromFlag();
      if (originalEnv === undefined) delete process.env.LOBEHUB_WORKSPACE_ID;
      else process.env.LOBEHUB_WORKSPACE_ID = originalEnv;
      if (originalJwt === undefined) delete process.env.LOBEHUB_JWT;
      else process.env.LOBEHUB_JWT = originalJwt;
    });

    it('resolves a flag slug and reports the flag as the source', async () => {
      await applyWorkspaceOverride('acme', 'workspace');
      expect(resolveWorkspaceScope()).toEqual({ source: 'flag', workspaceId: 'ws_1' });
    });

    it('lets the flag outrank the env value, even an unresolvable one', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'bogus';
      await applyWorkspaceOverride('acme', 'workspace');
      expect(resolveWorkspaceScope()).toEqual({ source: 'flag', workspaceId: 'ws_1' });
    });

    it('exits on a flag value that matches nothing, without touching the env', async () => {
      await expect(applyWorkspaceOverride('bogus', 'workspace')).rejects.toThrow('process.exit');
      expect(process.env.LOBEHUB_WORKSPACE_ID).toBeUndefined();
    });

    it('exits on an empty flag rather than falling through to the saved scope', async () => {
      await expect(applyWorkspaceOverride('  ', 'workspace')).rejects.toThrow('process.exit');
      expect(mockList).not.toHaveBeenCalled();
    });

    it('accepts personal from the flag without a lookup', async () => {
      await applyWorkspaceOverride('personal', 'workspace');
      expect(resolveWorkspaceScope()).toEqual({ source: 'flag' });
      expect(mockList).not.toHaveBeenCalled();
    });

    it('resolves an env slug and keeps env as the source', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'acme';
      await applyWorkspaceOverride(undefined, 'workspace');
      expect(resolveWorkspaceScope()).toEqual({ source: 'env', workspaceId: 'ws_1' });
    });

    it('exits on an env value that matches nothing', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'bogus';
      await expect(applyWorkspaceOverride(undefined, 'workspace')).rejects.toThrow('process.exit');
    });

    it('leaves the env value alone in a dispatched run', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'ws_dispatched';
      process.env.LOBEHUB_JWT = 'token';
      await applyWorkspaceOverride(undefined, 'workspace');
      expect(process.env.LOBEHUB_WORKSPACE_ID).toBe('ws_dispatched');
      expect(mockList).not.toHaveBeenCalled();
    });

    it('names the env var when its value matches nothing', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'bogus';
      await expect(applyWorkspaceOverride(undefined, 'workspace')).rejects.toThrow('process.exit');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('LOBEHUB_WORKSPACE_ID'));
    });

    it.each(['connect', 'status', 'login'])('rejects the flag on %s', async (command) => {
      await expect(applyWorkspaceOverride('acme', command)).rejects.toThrow('process.exit');
      expect(mockList).not.toHaveBeenCalled();
    });

    it('accepts the flag on doctor, which reports the scope', async () => {
      await applyWorkspaceOverride('acme', 'doctor');
      expect(resolveWorkspaceScope()).toEqual({ source: 'flag', workspaceId: 'ws_1' });
    });

    it('stays quiet when an API key cannot look up its env value', async () => {
      const original = process.env.LOBEHUB_CLI_API_KEY;
      process.env.LOBEHUB_CLI_API_KEY = 'key';
      process.env.LOBEHUB_WORKSPACE_ID = 'ws_x';
      mockList.mockRejectedValue(trpcError('FORBIDDEN'));

      await applyWorkspaceOverride(undefined, 'workspace');

      expect(process.env.LOBEHUB_WORKSPACE_ID).toBe('ws_x');
      expect(log.warn).not.toHaveBeenCalled();
      if (original === undefined) delete process.env.LOBEHUB_CLI_API_KEY;
      else process.env.LOBEHUB_CLI_API_KEY = original;
    });

    it('lets a command-level --workspace outrank an unresolvable global flag', async () => {
      await applyWorkspaceOverride('bogus', 'workspace', true);
      expect(mockList).not.toHaveBeenCalled();
      expect(process.env.LOBEHUB_WORKSPACE_ID).toBeUndefined();
    });

    it('lets a command-level --workspace outrank an unresolvable env value', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'bogus';
      await applyWorkspaceOverride(undefined, 'workspace', true);
      expect(mockList).not.toHaveBeenCalled();
    });

    it.each([
      '__complete',
      'completion',
      'connect',
      'doctor',
      'login',
      'logout',
      'man',
      'status',
      'update',
    ])('does not let a bad env value block %s', async (command) => {
      process.env.LOBEHUB_WORKSPACE_ID = 'bogus';
      await applyWorkspaceOverride(undefined, command);
      expect(mockList).not.toHaveBeenCalled();
    });

    it('hides the env value from the lookup and restores it afterwards', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'bogus';
      let seen: string | undefined = 'unset';
      mockList.mockImplementation(async () => {
        seen = process.env.LOBEHUB_WORKSPACE_ID;
        return workspaces;
      });

      await listWorkspaces();

      expect(seen).toBe('personal');
      expect(process.env.LOBEHUB_WORKSPACE_ID).toBe('bogus');
    });
  });
});

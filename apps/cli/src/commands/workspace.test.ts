import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerWorkspaceCommand } from './workspace';

const {
  mockClient,
  mockGetTrpcClient,
  mockResolveIdentityFingerprint,
  mockResolveWorkspaceScope,
  mockSaveActiveWorkspace,
} = vi.hoisted(() => ({
  mockClient: {
    workspace: {
      create: { mutate: vi.fn() },
      getById: { query: vi.fn() },
      getMyStatistics: { query: vi.fn() },
      getSettings: { query: vi.fn() },
      getStatistics: { query: vi.fn() },
      list: { query: vi.fn() },
      update: { mutate: vi.fn() },
    },
    workspaceAuditLog: { list: { query: vi.fn() } },
    workspaceMember: {
      invite: { mutate: vi.fn() },
      list: { query: vi.fn() },
      listInvitations: { query: vi.fn() },
    },
    workspaceUsage: { getCurrentUsage: { query: vi.fn() } },
  },
  mockGetTrpcClient: vi.fn(),
  mockResolveIdentityFingerprint: vi.fn<() => string | undefined>(),
  mockResolveWorkspaceScope: vi.fn(),
  mockSaveActiveWorkspace: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../api/workspace', () => ({ resolveWorkspaceScope: mockResolveWorkspaceScope }));
vi.mock('../auth/identity', () => ({
  resolveIdentityFingerprint: mockResolveIdentityFingerprint,
}));
vi.mock('../settings', () => ({
  resolveServerUrl: () => 'https://app.lobehub.com',
  saveActiveWorkspace: mockSaveActiveWorkspace,
}));

/** Stand in for the resolved scope every command reads. */
const scopedTo = (workspaceId?: string) =>
  mockResolveWorkspaceScope.mockImplementation((explicit?: string) => {
    if (explicit) return { source: 'explicit', workspaceId: explicit };
    if (process.env.LOBEHUB_WORKSPACE_ID)
      return { source: 'env', workspaceId: process.env.LOBEHUB_WORKSPACE_ID };
    return workspaceId ? { source: 'settings', workspaceId } : { source: 'personal' };
  });

const createProgram = () => {
  const program = new Command();
  program.exitOverride();
  registerWorkspaceCommand(program);
  return program;
};

const run = (...argv: string[]) => createProgram().parseAsync(['node', 'test', ...argv]);

describe('workspace command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  const originalWorkspaceId = process.env.LOBEHUB_WORKSPACE_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOBEHUB_WORKSPACE_ID;
    scopedTo(undefined);
    mockResolveIdentityFingerprint.mockReturnValue('user:u1');
    mockGetTrpcClient.mockResolvedValue(mockClient);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalWorkspaceId === undefined) delete process.env.LOBEHUB_WORKSPACE_ID;
    else process.env.LOBEHUB_WORKSPACE_ID = originalWorkspaceId;
  });

  describe('list', () => {
    it('lists workspaces and marks the active one', async () => {
      mockClient.workspace.list.query.mockResolvedValue([
        { id: 'ws_1', name: 'Acme', plan: 'pro', role: 'owner', slug: 'acme' },
        { id: 'ws_2', name: 'Beta', role: 'member', slug: 'beta' },
      ]);
      scopedTo('ws_2');

      await run('workspace', 'list');

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('Acme');
      expect(output).toContain('* ws_2');
      expect(output).not.toContain('* ws_1');
    });

    // The marker has to follow the same precedence every other command uses.
    it('marks the env-selected workspace over the persisted one', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'ws_1';
      scopedTo('ws_2');
      mockClient.workspace.list.query.mockResolvedValue([
        { id: 'ws_1', name: 'Acme', role: 'owner', slug: 'acme' },
        { id: 'ws_2', name: 'Beta', role: 'member', slug: 'beta' },
      ]);

      await run('workspace', 'list');

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('* ws_1');
      expect(output).not.toContain('* ws_2');
    });

    it('reports an empty account instead of printing an empty table', async () => {
      mockClient.workspace.list.query.mockResolvedValue([]);

      await run('workspace', 'list');

      expect(consoleSpy).toHaveBeenCalledWith('No workspaces found.');
    });
  });

  describe('use', () => {
    it('accepts a slug and persists the resolved id', async () => {
      mockClient.workspace.list.query.mockResolvedValue([
        { id: 'ws_1', name: 'Acme', role: 'owner', slug: 'acme' },
      ]);

      await run('workspace', 'use', 'acme');

      expect(mockSaveActiveWorkspace).toHaveBeenCalledWith({
        identity: 'user:u1',
        serverUrl: 'https://app.lobehub.com',
        workspaceId: 'ws_1',
      });
    });

    it('refuses a workspace the account does not belong to', async () => {
      mockClient.workspace.list.query.mockResolvedValue([
        { id: 'ws_1', name: 'Acme', role: 'owner', slug: 'acme' },
      ]);

      await expect(run('workspace', 'use', 'ws_missing')).rejects.toThrow('process.exit');
      expect(mockSaveActiveWorkspace).not.toHaveBeenCalled();
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('ws_missing'));
    });

    // The env var wins in `resolveWorkspaceScope`, so persisting silently would
    // leave the user staring at the old scope.
    it('warns when LOBEHUB_WORKSPACE_ID would override the new scope', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'ws_env';
      mockClient.workspace.list.query.mockResolvedValue([
        { id: 'ws_1', name: 'Acme', role: 'owner', slug: 'acme' },
      ]);

      await run('workspace', 'use', 'ws_1');

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('LOBEHUB_WORKSPACE_ID'));
    });

    // Without an identity the record cannot be bound, and an unbound scope is
    // exactly what survives an account switch.
    it('refuses to persist a scope when not logged in', async () => {
      mockResolveIdentityFingerprint.mockReturnValue(undefined);
      mockClient.workspace.list.query.mockResolvedValue([
        { id: 'ws_1', name: 'Acme', role: 'owner', slug: 'acme' },
      ]);

      await expect(run('workspace', 'use', 'acme')).rejects.toThrow('process.exit');
      expect(mockSaveActiveWorkspace).not.toHaveBeenCalled();
    });

    it('clears the scope with --personal', async () => {
      await run('workspace', 'use', '--personal');

      expect(mockSaveActiveWorkspace).toHaveBeenCalledWith(null);
      expect(mockClient.workspace.list.query).not.toHaveBeenCalled();
      expect(log.warn).not.toHaveBeenCalled();
    });

    // Clearing the file does not clear the env var, so "Scope set to personal"
    // on its own would leave the next mutation pointed at a workspace.
    it('warns that --personal does not beat LOBEHUB_WORKSPACE_ID', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'ws_env';

      await run('workspace', 'use', '--personal');

      expect(mockSaveActiveWorkspace).toHaveBeenCalledWith(null);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('ws_env'));
    });
  });

  describe('scoped reads', () => {
    it('fails with an actionable message when no workspace scope is set', async () => {
      await expect(run('workspace', 'members')).rejects.toThrow('process.exit');

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('workspace use'));
      expect(mockClient.workspaceMember.list.query).not.toHaveBeenCalled();
    });

    it('sends the --workspace override into the client scope', async () => {
      mockClient.workspaceMember.list.query.mockResolvedValue([]);

      await run('workspace', 'members', '--workspace', 'ws_9');

      expect(mockGetTrpcClient).toHaveBeenCalledWith('ws_9');
      expect(consoleSpy).toHaveBeenCalledWith('No members found.');
    });

    it('lists members of the active workspace', async () => {
      scopedTo('ws_1');
      mockClient.workspaceMember.list.query.mockResolvedValue([
        {
          joinedAt: new Date().toISOString(),
          role: 'admin',
          user: { email: 'a@example.com', fullName: 'Ada' },
          userId: 'user_1',
        },
      ]);

      await run('workspace', 'members');

      expect(mockGetTrpcClient).toHaveBeenCalledWith('ws_1');
      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('Ada');
      expect(output).toContain('a@example.com');
    });
  });

  describe('view', () => {
    it('reads the workspace passed as an argument', async () => {
      mockClient.workspace.getById.query.mockResolvedValue({
        id: 'ws_1',
        name: 'Acme',
        slug: 'acme',
      });

      await run('workspace', 'view', 'ws_1', '--json');

      expect(mockGetTrpcClient).toHaveBeenCalledWith('ws_1');
      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify({ id: 'ws_1', name: 'Acme', slug: 'acme' }, null, 2),
      );
    });

    it('exits when the workspace is gone', async () => {
      scopedTo('ws_1');
      mockClient.workspace.getById.query.mockResolvedValue(null);

      await expect(run('workspace', 'view')).rejects.toThrow('process.exit');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('ws_1'));
    });
  });

  describe('create', () => {
    it('creates a workspace and can switch to it', async () => {
      mockClient.workspace.create.mutate.mockResolvedValue({ id: 'ws_new', name: 'Acme' });

      await run('workspace', 'create', 'Acme', '--slug', 'acme', '--use');

      expect(mockClient.workspace.create.mutate).toHaveBeenCalledWith({
        avatar: undefined,
        description: undefined,
        name: 'Acme',
        slug: 'acme',
      });
      expect(mockSaveActiveWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ identity: 'user:u1', workspaceId: 'ws_new' }),
      );
    });

    it('warns that --use does not beat LOBEHUB_WORKSPACE_ID', async () => {
      process.env.LOBEHUB_WORKSPACE_ID = 'ws_env';
      mockClient.workspace.create.mutate.mockResolvedValue({ id: 'ws_new', name: 'Acme' });

      await run('workspace', 'create', 'Acme', '--slug', 'acme', '--use');

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('ws_env'));
    });
  });

  describe('update', () => {
    it('rejects an update with no fields instead of sending an empty patch', async () => {
      scopedTo('ws_1');

      await expect(run('workspace', 'update')).rejects.toThrow('process.exit');
      expect(mockClient.workspace.update.mutate).not.toHaveBeenCalled();
    });

    it('sends only the provided fields', async () => {
      scopedTo('ws_1');

      await run('workspace', 'update', '--name', 'Acme Inc');

      expect(mockClient.workspace.update.mutate).toHaveBeenCalledWith({
        avatar: undefined,
        description: undefined,
        name: 'Acme Inc',
        slug: undefined,
      });
    });
  });

  describe('stats', () => {
    it('reads workspace-wide totals by default and own totals with --mine', async () => {
      scopedTo('ws_1');
      mockClient.workspace.getStatistics.query.mockResolvedValue({
        agents: 3,
        messages: 10,
        messagesToday: 2,
        topics: 5,
      });
      mockClient.workspace.getMyStatistics.query.mockResolvedValue({
        agents: 1,
        messages: 4,
        messagesToday: 1,
        topics: 2,
      });

      await run('workspace', 'stats');
      expect(mockClient.workspace.getStatistics.query).toHaveBeenCalled();

      await run('workspace', 'stats', '--mine');
      expect(mockClient.workspace.getMyStatistics.query).toHaveBeenCalled();
    });

    // Workspace-wide totals are admin-only, so a plain member otherwise gets a
    // bare FORBIDDEN for a question they are allowed to ask a different way.
    it('points a non-admin at --mine instead of surfacing FORBIDDEN', async () => {
      scopedTo('ws_1');
      mockClient.workspace.getStatistics.query.mockRejectedValue({ data: { code: 'FORBIDDEN' } });

      await expect(run('workspace', 'stats')).rejects.toThrow('process.exit');
      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('--mine'));
    });

    it('lets an unrelated failure through instead of blaming permissions', async () => {
      scopedTo('ws_1');
      mockClient.workspace.getStatistics.query.mockRejectedValue(new Error('fetch failed'));

      await expect(run('workspace', 'stats')).rejects.toThrow('fetch failed');
    });
  });

  describe('invite', () => {
    it('rejects an unknown role before hitting the server', async () => {
      scopedTo('ws_1');

      await expect(
        run('workspace', 'invite', 'a@example.com', '--role', 'superuser'),
      ).rejects.toThrow('process.exit');
      expect(mockClient.workspaceMember.invite.mutate).not.toHaveBeenCalled();
    });

    it('invites with the default member role', async () => {
      scopedTo('ws_1');
      mockClient.workspaceMember.invite.mutate.mockResolvedValue({ id: 'inv_1' });

      await run('workspace', 'invite', 'a@example.com');

      expect(mockClient.workspaceMember.invite.mutate).toHaveBeenCalledWith({
        email: 'a@example.com',
        role: 'member',
      });
    });
  });

  describe('invitations', () => {
    // `timeAgo` on a future timestamp renders "-604800s ago".
    it('counts down to the expiry instead of rendering a negative age', async () => {
      scopedTo('ws_1');
      mockClient.workspaceMember.listInvitations.query.mockResolvedValue([
        {
          email: 'a@example.com',
          expiresAt: new Date(Date.now() + 6 * 86_400_000 + 60_000).toISOString(),
          id: 'inv_1',
          role: 'member',
          status: 'pending',
        },
      ]);

      await run('workspace', 'invitations');

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('in 6d');
      expect(output).not.toContain('ago');
    });
  });

  describe('audit-log', () => {
    it('passes filters through and renders entries', async () => {
      scopedTo('ws_1');
      mockClient.workspaceAuditLog.list.query.mockResolvedValue({
        items: [
          {
            action: 'workspace.updated',
            createdAt: new Date().toISOString(),
            id: 'log_1',
            resourceType: null,
            userId: 'user_1',
          },
        ],
        nextCursor: null,
      });

      await run('workspace', 'audit-log', '--action', 'workspace.updated', '-L', '5');

      expect(mockClient.workspaceAuditLog.list.query).toHaveBeenCalledWith({
        action: 'workspace.updated',
        endDate: undefined,
        limit: 5,
        q: undefined,
        resourceType: undefined,
        startDate: undefined,
      });
      expect(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
        'workspace.updated',
      );
    });

    it('rejects a non-numeric limit', async () => {
      scopedTo('ws_1');

      await expect(run('workspace', 'audit-log', '-L', 'many')).rejects.toThrow('process.exit');
      expect(mockClient.workspaceAuditLog.list.query).not.toHaveBeenCalled();
    });
  });

  describe('usage', () => {
    it('renders spend per type', async () => {
      scopedTo('ws_1');
      mockClient.workspaceUsage.getCurrentUsage.query.mockResolvedValue({
        remainingBalance: 12.5,
        since: '2026-08-01T00:00:00.000Z',
        subscription: null,
        until: '2026-08-31T00:00:00.000Z',
        usageByType: [{ spend: 3.25, type: 'chat' }],
      });

      await run('workspace', 'usage');

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('2026-08-01 → 2026-08-31');
      expect(output).toContain('$12.50');
      expect(output).toContain('$3.25');
    });
  });

  describe('current', () => {
    it('reports personal scope without calling the server', async () => {
      await run('workspace', 'current');

      expect(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('personal');
      expect(mockGetTrpcClient).not.toHaveBeenCalled();
    });

    it('names the active workspace and where the scope came from', async () => {
      scopedTo('ws_1');
      mockClient.workspace.getById.query.mockResolvedValue({
        id: 'ws_1',
        name: 'Acme',
        slug: 'acme',
      });

      await run('workspace', 'current');

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('ws_1');
      expect(output).toContain('workspace use');
      expect(output).toContain('Acme');
    });

    it('flags a scope id the server cannot resolve', async () => {
      scopedTo('ws_typo');
      mockClient.workspace.getById.query.mockResolvedValue(null);

      await run('workspace', 'current');

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('did not resolve'));
    });

    // A revoked membership must not turn `workspace current` into a stack trace,
    // but the reason has to survive — a network or auth failure is actionable
    // and must not be reported as a membership problem.
    it('reports the real reason when the workspace is unreachable', async () => {
      scopedTo('ws_1');
      mockClient.workspace.getById.query.mockRejectedValue(new Error('fetch failed'));

      await run('workspace', 'current');

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('fetch failed'));
    });
  });
});

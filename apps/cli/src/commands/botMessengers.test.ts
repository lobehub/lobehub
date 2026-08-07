import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FormatModule from '../utils/format';
import { registerBotMessengersCommands } from './botMessengers';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    messenger: {
      availablePlatforms: { query: vi.fn() },
      getMyLink: { query: vi.fn() },
      listMyInstallations: { query: vi.fn() },
      listMyLinks: { query: vi.fn() },
      setActiveAgent: { mutate: vi.fn() },
      unlink: { mutate: vi.fn() },
      uninstallInstallation: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

// `confirm` always answers yes — we test uninstall/unlink under the explicit
// `--yes` flag too, but for the prompt path we want a deterministic answer.
vi.mock('../utils/format', async () => {
  const actual = await vi.importActual<typeof FormatModule>('../utils/format');
  return { ...actual, confirm: vi.fn(async () => true) };
});

describe('bot messengers', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    for (const fn of [
      mockTrpcClient.messenger.availablePlatforms.query,
      mockTrpcClient.messenger.getMyLink.query,
      mockTrpcClient.messenger.listMyInstallations.query,
      mockTrpcClient.messenger.listMyLinks.query,
      mockTrpcClient.messenger.setActiveAgent.mutate,
      mockTrpcClient.messenger.unlink.mutate,
      mockTrpcClient.messenger.uninstallInstallation.mutate,
    ]) {
      fn.mockReset();
    }
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    const bot = program.command('bot');
    registerBotMessengersCommands(bot);
    return program;
  }

  function renderedOutput(): string {
    return consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
  }

  // ── installations ──────────────────────────────────────

  describe('list', () => {
    it('renders the installation table with SEND ARG hint', async () => {
      mockTrpcClient.messenger.listMyInstallations.query.mockResolvedValueOnce([
        {
          applicationId: 'A1',
          id: 'inst_abc',
          installedAt: '2026-01-15T00:00:00Z',
          platform: 'slack',
          tenantId: 'T1',
          tenantName: 'Acme Corp',
        },
      ]);
      await createProgram().parseAsync(['node', 'test', 'bot', 'messengers', 'list']);
      const out = renderedOutput();
      expect(mockTrpcClient.messenger.listMyInstallations.query).toHaveBeenCalled();
      expect(out).toContain('inst_abc');
      expect(out).toContain('Acme Corp');
      // The hint should explain how to use the id with the send commands
      expect(out).toContain('@<INSTALLATION ID>');
    });

    it('reports empty state with install guidance', async () => {
      mockTrpcClient.messenger.listMyInstallations.query.mockResolvedValueOnce([]);
      await createProgram().parseAsync(['node', 'test', 'bot', 'messengers', 'list']);
      const out = renderedOutput();
      expect(out).toContain('No System Bot installations connected.');
      expect(out).toContain('Settings → Messenger');
    });

    it('--json passes through the payload', async () => {
      const payload = [{ id: 'inst_only', platform: 'discord', tenantId: 'g1' }];
      mockTrpcClient.messenger.listMyInstallations.query.mockResolvedValueOnce(payload);
      await createProgram().parseAsync(['node', 'test', 'bot', 'messengers', 'list', '--json']);
      expect(renderedOutput()).toContain('"id": "inst_only"');
    });
  });

  describe('view', () => {
    it('prints details for a matching install', async () => {
      mockTrpcClient.messenger.listMyInstallations.query.mockResolvedValueOnce([
        {
          applicationId: 'A1',
          id: 'inst_match',
          installedAt: '2026-01-15T00:00:00Z',
          platform: 'slack',
          scope: 'chat:write,users:read',
          tenantId: 'T1',
          tenantName: 'Acme Corp',
        },
      ]);
      await createProgram().parseAsync(['node', 'test', 'bot', 'messengers', 'view', 'inst_match']);
      const out = renderedOutput();
      expect(out).toContain('inst_match');
      expect(out).toContain('slack');
      expect(out).toContain('Acme Corp');
      expect(out).toContain('chat:write,users:read');
    });

    it('exits non-zero when install missing', async () => {
      mockTrpcClient.messenger.listMyInstallations.query.mockResolvedValueOnce([]);
      await createProgram().parseAsync([
        'node',
        'test',
        'bot',
        'messengers',
        'view',
        'inst_missing',
      ]);
      expect(errorSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('--json missing install emits JSON null + exit 1 (scriptable)', async () => {
      mockTrpcClient.messenger.listMyInstallations.query.mockResolvedValueOnce([]);
      await createProgram().parseAsync([
        'node',
        'test',
        'bot',
        'messengers',
        'view',
        'inst_missing',
        '--json',
      ]);
      // No human-readable error log; the JSON-pipe consumer gets `null`.
      expect(errorSpy).not.toHaveBeenCalled();
      expect(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('null');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('uninstall', () => {
    it('--yes skips confirm and calls the mutation', async () => {
      mockTrpcClient.messenger.uninstallInstallation.mutate.mockResolvedValueOnce({
        success: true,
      });
      await createProgram().parseAsync([
        'node',
        'test',
        'bot',
        'messengers',
        'uninstall',
        'inst_abc',
        '--yes',
      ]);
      expect(mockTrpcClient.messenger.uninstallInstallation.mutate).toHaveBeenCalledWith({
        installationId: 'inst_abc',
      });
      expect(renderedOutput()).toContain('revoked');
    });

    it('confirms before calling when --yes is omitted', async () => {
      mockTrpcClient.messenger.listMyInstallations.query.mockResolvedValueOnce([
        { id: 'inst_abc', platform: 'slack', tenantId: 'T1', tenantName: 'Acme' },
      ]);
      mockTrpcClient.messenger.uninstallInstallation.mutate.mockResolvedValueOnce({
        success: true,
      });
      await createProgram().parseAsync([
        'node',
        'test',
        'bot',
        'messengers',
        'uninstall',
        'inst_abc',
      ]);
      // Mocked confirm returns true → mutation still fires
      expect(mockTrpcClient.messenger.uninstallInstallation.mutate).toHaveBeenCalled();
    });
  });

  describe('platforms', () => {
    it('renders the platforms table', async () => {
      mockTrpcClient.messenger.availablePlatforms.query.mockResolvedValueOnce([
        { appId: 'A123', id: 'slack', name: 'Slack' },
        { botUsername: 'lobehub_bot', id: 'telegram', name: 'Telegram' },
      ]);
      await createProgram().parseAsync(['node', 'test', 'bot', 'messengers', 'platforms']);
      const out = renderedOutput();
      expect(out).toContain('slack');
      expect(out).toContain('A123');
      expect(out).toContain('lobehub_bot');
    });

    it('handles empty platform list gracefully', async () => {
      mockTrpcClient.messenger.availablePlatforms.query.mockResolvedValueOnce([]);
      await createProgram().parseAsync(['node', 'test', 'bot', 'messengers', 'platforms']);
      expect(renderedOutput()).toContain('No System Bot platforms');
    });
  });

  // ── links ──────────────────────────────────────────────

  describe('links list', () => {
    it('renders the links table', async () => {
      mockTrpcClient.messenger.listMyLinks.query.mockResolvedValueOnce([
        {
          activeAgentId: 'agent_1',
          platform: 'slack',
          platformUserId: 'U1',
          platformUsername: 'alice',
          tenantId: 'T1',
        },
      ]);
      await createProgram().parseAsync(['node', 'test', 'bot', 'messengers', 'links', 'list']);
      const out = renderedOutput();
      expect(out).toContain('agent_1');
      expect(out).toContain('alice');
    });

    it('reports empty state', async () => {
      mockTrpcClient.messenger.listMyLinks.query.mockResolvedValueOnce([]);
      await createProgram().parseAsync(['node', 'test', 'bot', 'messengers', 'links', 'list']);
      expect(renderedOutput()).toContain('No account links yet');
    });
  });

  describe('links view', () => {
    it('shows the link detail', async () => {
      mockTrpcClient.messenger.getMyLink.query.mockResolvedValueOnce({
        activeAgentId: 'agent_2',
        platform: 'slack',
        platformUserId: 'U2',
        platformUsername: 'bob',
        tenantId: 'T2',
      });
      await createProgram().parseAsync([
        'node',
        'test',
        'bot',
        'messengers',
        'links',
        'view',
        'slack',
        '--tenant',
        'T2',
      ]);
      expect(mockTrpcClient.messenger.getMyLink.query).toHaveBeenCalledWith({
        platform: 'slack',
        tenantId: 'T2',
      });
      expect(renderedOutput()).toContain('agent_2');
    });

    it('exits non-zero on missing link', async () => {
      mockTrpcClient.messenger.getMyLink.query.mockResolvedValueOnce(null);
      await createProgram().parseAsync([
        'node',
        'test',
        'bot',
        'messengers',
        'links',
        'view',
        'discord',
      ]);
      expect(errorSpy).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('links set-agent', () => {
    it('accepts WeChat as a link-management platform', async () => {
      mockTrpcClient.messenger.setActiveAgent.mutate.mockResolvedValueOnce({ success: true });
      await createProgram().parseAsync([
        'node',
        'test',
        'bot',
        'messengers',
        'links',
        'set-agent',
        'wechat',
        '--agent',
        'agent_wechat',
      ]);
      expect(mockTrpcClient.messenger.setActiveAgent.mutate).toHaveBeenCalledWith({
        agentId: 'agent_wechat',
        platform: 'wechat',
        tenantId: undefined,
      });
    });

    it('passes agentId through to setActiveAgent', async () => {
      mockTrpcClient.messenger.setActiveAgent.mutate.mockResolvedValueOnce({ success: true });
      await createProgram().parseAsync([
        'node',
        'test',
        'bot',
        'messengers',
        'links',
        'set-agent',
        'slack',
        '--agent',
        'agent_xyz',
        '--tenant',
        'T1',
      ]);
      expect(mockTrpcClient.messenger.setActiveAgent.mutate).toHaveBeenCalledWith({
        agentId: 'agent_xyz',
        platform: 'slack',
        tenantId: 'T1',
      });
    });

    it('clears the agent when --agent none is passed', async () => {
      mockTrpcClient.messenger.setActiveAgent.mutate.mockResolvedValueOnce({ success: true });
      await createProgram().parseAsync([
        'node',
        'test',
        'bot',
        'messengers',
        'links',
        'set-agent',
        'telegram',
        '--agent',
        'none',
      ]);
      expect(mockTrpcClient.messenger.setActiveAgent.mutate).toHaveBeenCalledWith({
        agentId: null,
        platform: 'telegram',
        tenantId: undefined,
      });
    });
  });

  describe('links unlink', () => {
    it('passes platform + tenant to the unlink mutation with --yes', async () => {
      mockTrpcClient.messenger.unlink.mutate.mockResolvedValueOnce({ success: true });
      await createProgram().parseAsync([
        'node',
        'test',
        'bot',
        'messengers',
        'links',
        'unlink',
        'slack',
        '--tenant',
        'T1',
        '--yes',
      ]);
      expect(mockTrpcClient.messenger.unlink.mutate).toHaveBeenCalledWith({
        platform: 'slack',
        tenantId: 'T1',
      });
    });
  });
});

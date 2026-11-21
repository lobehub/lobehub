import type { InboundWebhookItem } from '@lobechat/types';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FormatUtils from '../utils/format';
import { log } from '../utils/logger';
import { registerAutomationCommand } from './automation';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    inboundWebhook: {
      check: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      get: { query: vi.fn() },
      list: { query: vi.fn() },
      update: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({ getTrpcClient: vi.fn() }));
const { mockConfirm } = vi.hoisted(() => ({ mockConfirm: vi.fn() }));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../utils/format', async (importOriginal) => {
  const actual = await importOriginal<typeof FormatUtils>();
  return { ...actual, confirm: mockConfirm };
});

const ID = '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const WEBHOOK_ID = '0b9f3c2e-1a4d-4c8e-9f6a-2d7b8e1c3a5f';

const automation = (overrides: Partial<InboundWebhookItem> = {}): InboundWebhookItem => ({
  agent: { avatar: null, backgroundColor: null, id: 'agt_1', title: 'Triage Bot' },
  canCheck: true,
  canConfigure: true,
  canManage: true,
  channel: null,
  connector: { agentId: null, avatar: null, id: 'conn_1', identifier: 'github', name: 'GitHub' },
  createdAt: '2026-11-01T10:00:00.000Z',
  creatorId: 'user_1',
  endpoint: null,
  expiresAt: null,
  id: ID,
  identifier: 'issue.opened',
  instructions: null,
  kind: 'mcp_events',
  lastDeliveryAt: null,
  lastError: null,
  name: null,
  source: { arguments: { repo: 'lobehub/lobehub' }, eventName: 'issue.opened', kind: 'mcp_events' },
  status: 'active',
  topic: { id: 'tpc_1', title: 'Issue triage' },
  ...overrides,
});

const customWebhook = (): InboundWebhookItem => ({
  ...automation(),
  canCheck: false,
  connector: null,
  endpoint: `https://app.test/webhooks/inbound/${WEBHOOK_ID}`,
  id: WEBHOOK_ID,
  identifier: 'ci-alerts',
  kind: 'generic',
  name: 'CI alerts',
  source: { autoApprove: false, kind: 'generic', topicMode: 'new' },
  topic: null,
});

// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) => text.replaceAll(/\x1B\[[\d;]*m/g, '');

describe('automation command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockConfirm.mockReset();
    for (const method of Object.values(mockTrpcClient.inboundWebhook)) {
      for (const fn of Object.values(method)) (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const run = (...args: string[]) => {
    const program = new Command();
    program.exitOverride();
    registerAutomationCommand(program);
    return program.parseAsync(['node', 'test', 'automation', ...args]);
  };

  const output = () => stripAnsi(consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n'));
  const errors = () => errorSpy.mock.calls.map((call) => String(call[0])).join('\n');

  /** A custom webhook id is refused with the `lh webhook` command that does the job. */
  const expectWebhookRefused = (usage: string) => {
    expect(errors()).toContain(
      `${WEBHOOK_ID} is a custom webhook, not an automation (MCP Events subscription)`,
    );
    expect(errors()).toContain(usage);
  };

  describe('list', () => {
    it('asks the server for MCP Events subscriptions only and prints a row each', async () => {
      mockTrpcClient.inboundWebhook.list.query.mockResolvedValue([
        automation({
          channel: {
            id: 'chn_1',
            projectId: null,
            threadId: null,
            threadTitle: null,
            title: 'Eng',
          },
          lastDeliveryAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          name: 'Web bugs',
          source: {
            arguments: {},
            delivery: { channelId: 'chn_1' },
            eventName: 'issue.opened',
            kind: 'mcp_events',
          },
        }),
        automation({ id: WEBHOOK_ID, status: 'error' }),
      ]);

      await run('list');

      expect(mockTrpcClient.inboundWebhook.list.query).toHaveBeenCalledWith({
        kind: 'mcp_events',
      });
      const text = output();
      expect(text).toContain('CONNECTOR');
      expect(text).toContain('EVENT');
      expect(text).toContain('Web bugs');
      expect(text).toContain('GitHub');
      expect(text).toContain('issue.opened');
      expect(text).toContain('Channel Eng');
      expect(text).toContain('Topic Issue triage');
      expect(text).toContain('5m ago');
    });

    it('filters by agent on the server and outputs JSON', async () => {
      mockTrpcClient.inboundWebhook.list.query.mockResolvedValue([automation()]);

      await run('list', '--agent', 'agt_1', '--json', 'id,identifier');

      expect(mockTrpcClient.inboundWebhook.list.query).toHaveBeenCalledWith({
        agentId: 'agt_1',
        kind: 'mcp_events',
      });
      expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual([
        { id: ID, identifier: 'issue.opened' },
      ]);
    });

    it('says how to get one when there is none', async () => {
      mockTrpcClient.inboundWebhook.list.query.mockResolvedValue([]);

      await run('list');

      expect(output()).toContain('ask an agent in a conversation to subscribe');
    });
  });

  describe('view', () => {
    it('shows the event as the fixed identifier, connector, filter, results and expiry', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(
        automation({
          expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          lastError: 'auth',
          status: 'error',
        }),
      );

      await run('view', ID);

      expect(mockTrpcClient.inboundWebhook.get.query).toHaveBeenCalledWith({ id: ID });
      const text = output();
      expect(text.split('\n')[0]).toBe('issue.opened');
      expect(text).toMatch(/Name\s+\(none: shows the event\)/);
      expect(text).toMatch(/Event\s+issue\.opened \(how the agent knows it; fixed\)/);
      expect(text).toContain('GitHub (github)');
      expect(text).toContain('{"repo":"lobehub/lobehub"}');
      expect(text).toContain('Topic Issue triage (tpc_1)');
      expect(text).toContain('authorization has expired');
      expect(text).toMatch(/Expires\s+in /);
      expect(text).not.toContain('curl');
    });

    it('shows the Channel and Thread results are posted to', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(
        automation({
          channel: null,
          name: 'Web bugs',
          source: {
            arguments: {},
            delivery: { channelId: 'chn_9', threadId: 'cht_9' },
            eventName: 'issue.opened',
            kind: 'mcp_events',
          },
        }),
      );

      await run('view', ID);

      const text = output();
      expect(text.split('\n')[0]).toBe('Web bugs');
      expect(text).toContain('Channel chn_9 · Thread cht_9');
      expect(text).toContain('(you cannot see this Channel)');
      expect(text).toContain('(none: every event)');
    });

    it('refuses a custom webhook with a pointer to lh webhook', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(customWebhook());

      await expect(run('view', WEBHOOK_ID)).rejects.toThrow('exit:1');

      expectWebhookRefused(`lh webhook view ${WEBHOOK_ID}`);
    });

    it('rejects an id that is not a uuid without calling the server', async () => {
      await expect(run('view', 'issue.opened')).rejects.toThrow('exit:1');

      expect(errors()).toContain('lh automation list');
      expect(mockTrpcClient.inboundWebhook.get.query).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    beforeEach(() => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(automation());
    });

    it('sets the display name and keeps the event', async () => {
      mockTrpcClient.inboundWebhook.update.mutate.mockResolvedValue(
        automation({ name: 'Web bugs' }),
      );

      await run('rename', ID, '  Web bugs ');

      expect(mockTrpcClient.inboundWebhook.update.mutate).toHaveBeenCalledWith({
        id: ID,
        name: 'Web bugs',
      });
      expect(output()).toContain('Renamed to Web bugs (event issue.opened, unchanged)');
    });

    it('clears the name with --clear so the event shows', async () => {
      mockTrpcClient.inboundWebhook.update.mutate.mockResolvedValue(automation());

      await run('rename', ID, '--clear');

      expect(mockTrpcClient.inboundWebhook.update.mutate).toHaveBeenCalledWith({
        id: ID,
        name: null,
      });
      expect(output()).toContain('it shows as its event issue.opened');
    });

    it.each([
      [['rename', ID], 'Pass the new name, or --clear'],
      [['rename', ID, '   '], 'Pass the new name, or --clear'],
      [['rename', ID, 'x', '--clear'], 'not both'],
      [['rename', ID, 'x'.repeat(101)], 'at most 100 characters'],
    ])('rejects %j before calling the server', async (args, message) => {
      await expect(run(...args)).rejects.toThrow('exit:1');

      expect(errors()).toContain(message);
      expect(mockTrpcClient.inboundWebhook.get.query).not.toHaveBeenCalled();
      expect(mockTrpcClient.inboundWebhook.update.mutate).not.toHaveBeenCalled();
    });

    it('refuses a custom webhook with a pointer to lh webhook edit', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(customWebhook());

      await expect(run('rename', WEBHOOK_ID, 'Deploys')).rejects.toThrow('exit:1');

      expectWebhookRefused(`lh webhook edit ${WEBHOOK_ID} --name <name>`);
      expect(mockTrpcClient.inboundWebhook.update.mutate).not.toHaveBeenCalled();
    });
  });

  describe('check', () => {
    it('checks the subscription with its server', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(automation());
      mockTrpcClient.inboundWebhook.check.mutate.mockResolvedValue(automation());

      await run('check', ID);

      expect(mockTrpcClient.inboundWebhook.check.mutate).toHaveBeenCalledWith({ id: ID });
      expect(output()).toContain('the subscription is working');
    });

    it('reports a problem the check found', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(automation());
      mockTrpcClient.inboundWebhook.check.mutate.mockResolvedValue(
        automation({ lastError: 'auth', status: 'error' }),
      );

      await run('check', ID);

      expect(output()).toContain('issue.opened: error');
      expect(output()).toContain('authorization has expired');
    });

    it('refuses a custom webhook with a pointer to lh webhook test', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(customWebhook());

      await expect(run('check', WEBHOOK_ID)).rejects.toThrow('exit:1');

      expectWebhookRefused(`lh webhook test ${WEBHOOK_ID}`);
      expect(mockTrpcClient.inboundWebhook.check.mutate).not.toHaveBeenCalled();
    });

    it('surfaces the rate limit from the server', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(automation());
      mockTrpcClient.inboundWebhook.check.mutate.mockRejectedValue(
        new Error('Wait 30 seconds before checking again.'),
      );

      await expect(run('check', ID)).rejects.toThrow('exit:1');

      expect(errorSpy).toHaveBeenCalledWith('Wait 30 seconds before checking again.');
    });
  });

  describe('delete', () => {
    it('confirms that deleting ends the subscription on the MCP server', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(automation());
      mockConfirm.mockResolvedValue(true);

      await run('delete', ID);

      expect(mockConfirm).toHaveBeenCalledWith(
        expect.stringContaining('ends it on the MCP server'),
      );
      expect(mockTrpcClient.inboundWebhook.delete.mutate).toHaveBeenCalledWith({ id: ID });
      expect(output()).toContain('ended the subscription on its MCP server');
    });

    it('does nothing when declined', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(automation());
      mockConfirm.mockResolvedValue(false);

      await run('delete', ID);

      expect(mockTrpcClient.inboundWebhook.delete.mutate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Cancelled.');
    });

    it('skips the prompt with --yes', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(automation());

      await run('delete', ID, '--yes');

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockTrpcClient.inboundWebhook.delete.mutate).toHaveBeenCalledWith({ id: ID });
    });

    it('refuses a custom webhook before asking', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(customWebhook());

      await expect(run('delete', WEBHOOK_ID, '--yes')).rejects.toThrow('exit:1');

      expectWebhookRefused(`lh webhook delete ${WEBHOOK_ID}`);
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockTrpcClient.inboundWebhook.delete.mutate).not.toHaveBeenCalled();
    });
  });
});

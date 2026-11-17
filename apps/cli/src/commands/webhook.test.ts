import type { InboundWebhookItem } from '@lobechat/types';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as FormatUtils from '../utils/format';
import { log } from '../utils/logger';
import { registerWebhookCommand } from './webhook';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    inboundWebhook: {
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      get: { query: vi.fn() },
      list: { query: vi.fn() },
      listDeliveries: { query: vi.fn() },
      rotateToken: { mutate: vi.fn() },
      sendTest: { mutate: vi.fn() },
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

const ID = '0b9f3c2e-1a4d-4c8e-9f6a-2d7b8e1c3a5f';
const MCP_ID = '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const SECRET = 'whk_secret_value_123';

const generic = (overrides: Partial<InboundWebhookItem> = {}): InboundWebhookItem => ({
  agent: { avatar: null, backgroundColor: null, id: 'agt_1', title: 'Ops Bot' },
  canCheck: false,
  canConfigure: true,
  canManage: true,
  channel: null,
  connector: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  creatorId: 'user_1',
  endpoint: `https://app.test/webhooks/inbound/${ID}`,
  expiresAt: null,
  id: ID,
  identifier: 'ci-alerts',
  instructions: 'Summarize the failure',
  kind: 'generic',
  lastDeliveryAt: null,
  lastError: null,
  name: 'CI alerts',
  source: { autoApprove: false, kind: 'generic', topicMode: 'new' },
  status: 'active',
  topic: null,
  ...overrides,
});

const mcpEvents = (overrides: Partial<InboundWebhookItem> = {}): InboundWebhookItem => ({
  ...generic(),
  canCheck: true,
  connector: {
    agentId: null,
    avatar: null,
    id: 'conn_1',
    identifier: 'github',
    name: 'GitHub',
  },
  endpoint: null,
  expiresAt: null,
  id: MCP_ID,
  identifier: 'issue.opened',
  instructions: null,
  kind: 'mcp_events',
  name: null,
  source: { arguments: { repo: 'lobehub/lobehub' }, eventName: 'issue.opened', kind: 'mcp_events' },
  topic: { id: 'tpc_1', title: 'Issue triage' },
  ...overrides,
});

// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) => text.replaceAll(/\x1B\[[\d;]*m/g, '');

describe('webhook command', () => {
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
    registerWebhookCommand(program);
    return program.parseAsync(['node', 'test', 'webhook', ...args]);
  };

  const output = () => stripAnsi(consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n'));
  const errors = () => errorSpy.mock.calls.map((call) => String(call[0])).join('\n');

  describe('list', () => {
    it('lists custom webhooks only, with name, identifier, agent, status and target', async () => {
      mockTrpcClient.inboundWebhook.list.query.mockResolvedValue([
        generic({
          channel: {
            id: 'chn_1',
            projectId: null,
            threadId: 'cht_1',
            threadTitle: 'Deploys',
            title: 'Eng',
          },
          lastDeliveryAt: new Date(Date.now() - 3 * 60_000).toISOString(),
          source: {
            autoApprove: true,
            delivery: { channelId: 'chn_1', threadId: 'cht_1' },
            kind: 'generic',
            topicMode: 'new',
          },
        }),
        generic({ id: MCP_ID, identifier: 'webhook', name: null }),
      ]);

      await run('list');

      expect(mockTrpcClient.inboundWebhook.list.query).toHaveBeenCalledWith({ kind: 'generic' });
      const text = output();
      expect(text).toContain('IDENTIFIER');
      expect(text).not.toContain('KIND');
      expect(text).toContain('CI alerts');
      expect(text).toContain('ci-alerts');
      expect(text).toContain('Channel Eng · Thread Deploys');
      expect(text).toContain('3m ago');
      expect(text).toContain('never');
    });

    it('asks the server for one agent', async () => {
      mockTrpcClient.inboundWebhook.list.query.mockResolvedValue([generic()]);

      await run('list', '--agent', 'agt_1', '--json', 'id,identifier');

      expect(mockTrpcClient.inboundWebhook.list.query).toHaveBeenCalledWith({
        agentId: 'agt_1',
        kind: 'generic',
      });
      expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual([
        { id: ID, identifier: 'ci-alerts' },
      ]);
    });

    it('says when there is nothing', async () => {
      mockTrpcClient.inboundWebhook.list.query.mockResolvedValue([]);

      await run('list');

      expect(consoleSpy).toHaveBeenCalledWith('No webhooks found.');
    });
  });

  describe('view', () => {
    it('shows settings, the endpoint, a curl usage hint and the last error', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(
        generic({ lastError: 'wake_cap', status: 'error' }),
      );

      await run('view', ID);

      expect(mockTrpcClient.inboundWebhook.get.query).toHaveBeenCalledWith({ id: ID });
      const text = output();
      expect(text).toContain('New topic per call');
      expect(text).toContain('Summarize the failure');
      expect(text).toContain(`curl -X POST https://app.test/webhooks/inbound/${ID}`);
      expect(text).toContain('-H "Authorization: Bearer <key>"');
      expect(text).toContain("-H 'content-type: application/json'");
      expect(text).toContain('?thread=<key>');
      expect(text).toContain('Idempotency-Key');
      expect(text).toContain('(wake_cap)');
      expect(text).toContain(`lh webhook rotate-key ${ID}`);
    });

    it('shows the fixed identifier next to the name, and the identifier when unnamed', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());
      await run('view', ID);
      expect(output()).toMatch(/Name\s+CI alerts/);
      expect(output()).toMatch(/Identifier\s+ci-alerts \(how the agent knows it; fixed\)/);

      consoleSpy.mockClear();
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic({ name: null }));
      await run('view', ID);
      expect(output().split('\n')[0]).toBe('ci-alerts');
    });

    it('refuses an MCP Events subscription with a pointer to lh automation', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(mcpEvents());

      await expect(run('view', MCP_ID)).rejects.toThrow('exit:1');

      expect(errors()).toContain(
        `${MCP_ID} is an automation (MCP Events subscription), not a custom webhook`,
      );
      expect(errors()).toContain(`lh automation view ${MCP_ID}`);
      expect(output()).not.toContain('issue.opened');
    });

    it('rejects an id that is not a uuid without calling the server', async () => {
      await expect(run('view', 'ci-alerts')).rejects.toThrow('exit:1');

      expect(errors()).toContain('lh webhook list');
      expect(mockTrpcClient.inboundWebhook.get.query).not.toHaveBeenCalled();
    });

    it('surfaces a TRPC error message', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockRejectedValue(new Error('Webhook not found.'));

      await expect(run('view', ID)).rejects.toThrow('exit:1');

      expect(errorSpy).toHaveBeenCalledWith('Webhook not found.');
    });
  });

  describe('create', () => {
    it('creates with the given settings and prints the key exactly once', async () => {
      mockTrpcClient.inboundWebhook.create.mutate.mockResolvedValue({
        item: generic(),
        secret: SECRET,
      });

      await run(
        'create',
        '--agent',
        'agt_1',
        '--name',
        'CI alerts',
        '--instructions',
        'Summarize the failure',
        '--topic',
        'tpc_9',
      );

      expect(mockTrpcClient.inboundWebhook.create.mutate).toHaveBeenCalledWith({
        agentId: 'agt_1',
        instructions: 'Summarize the failure',
        name: 'CI alerts',
        topicId: 'tpc_9',
        topicMode: 'reuse',
      });
      const text = output();
      expect(text.split(SECRET)).toHaveLength(2);
      expect(text).toMatch(/Identifier\s+ci-alerts/);
      expect(text).toContain("won't be shown again");
      expect(text).toContain(`https://app.test/webhooks/inbound/${ID}`);
    });

    it('posts to a Thread of a Channel with auto-approval', async () => {
      mockTrpcClient.inboundWebhook.create.mutate.mockResolvedValue({
        item: generic(),
        secret: SECRET,
      });

      await run(
        'create',
        '--agent',
        'agt_1',
        '--auto-approve',
        '--channel',
        'chn_1',
        '--thread',
        'cht_1',
      );

      expect(mockTrpcClient.inboundWebhook.create.mutate).toHaveBeenCalledWith({
        agentId: 'agt_1',
        autoApprove: true,
        delivery: { channelId: 'chn_1', threadId: 'cht_1' },
      });
    });

    it('includes the key as secret in JSON', async () => {
      mockTrpcClient.inboundWebhook.create.mutate.mockResolvedValue({
        item: generic(),
        secret: SECRET,
      });

      await run('create', '--agent', 'agt_1', '--json', 'id,secret');

      expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual({ id: ID, secret: SECRET });
    });

    it('fails before calling the server when --channel lacks --auto-approve', async () => {
      await expect(run('create', '--agent', 'agt_1', '--channel', 'chn_1')).rejects.toThrow(
        'exit:1',
      );

      expect(errors()).toContain('needs --auto-approve');
      expect(mockTrpcClient.inboundWebhook.create.mutate).not.toHaveBeenCalled();
    });

    it('rejects --thread without --channel and a Thread id passed as --channel', async () => {
      await expect(run('create', '--agent', 'agt_1', '--thread', 'cht_1')).rejects.toThrow(
        'exit:1',
      );
      await expect(
        run('create', '--agent', 'agt_1', '--auto-approve', '--channel', 'cht_1'),
      ).rejects.toThrow('exit:1');

      expect(errors()).toContain('--channel <chn_id>');
      expect(errors()).toContain('cht_1 is a Thread id');
      expect(mockTrpcClient.inboundWebhook.create.mutate).not.toHaveBeenCalled();
    });

    it('rejects --topic with --topic-mode new', async () => {
      await expect(
        run('create', '--agent', 'agt_1', '--topic-mode', 'new', '--topic', 'tpc_1'),
      ).rejects.toThrow('exit:1');

      expect(errors()).toContain('--topic-mode reuse');
    });

    it('surfaces a server rejection', async () => {
      mockTrpcClient.inboundWebhook.create.mutate.mockRejectedValue(
        new Error('Pick one of your own topics of this agent.'),
      );

      await expect(run('create', '--agent', 'agt_1', '--topic', 'tpc_x')).rejects.toThrow('exit:1');

      expect(errorSpy).toHaveBeenCalledWith('Pick one of your own topics of this agent.');
    });
  });

  describe('edit', () => {
    beforeEach(() => {
      mockTrpcClient.inboundWebhook.update.mutate.mockImplementation(async () => generic());
    });

    it('maps flags to the update input', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());

      await run(
        'edit',
        ID,
        '--name',
        'Deploys',
        '--no-instructions',
        '--topic-mode',
        'reuse',
        '--auto-approve',
        '--channel',
        'chn_2',
      );

      expect(mockTrpcClient.inboundWebhook.update.mutate).toHaveBeenCalledWith({
        autoApprove: true,
        delivery: { channelId: 'chn_2' },
        id: ID,
        instructions: null,
        name: 'Deploys',
        topicMode: 'reuse',
      });
    });

    it('clears the Channel delivery with --no-channel and may then drop auto-approval', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(
        generic({
          source: {
            autoApprove: true,
            delivery: { channelId: 'chn_1' },
            kind: 'generic',
            topicMode: 'new',
          },
        }),
      );

      await run('edit', ID, '--no-channel', '--no-auto-approve', '--no-name', '--no-topic');

      expect(mockTrpcClient.inboundWebhook.update.mutate).toHaveBeenCalledWith({
        autoApprove: false,
        delivery: null,
        id: ID,
        name: null,
        topicId: null,
      });
    });

    it('keeps the current Channel when only --thread is given', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(
        generic({
          source: {
            autoApprove: true,
            delivery: { channelId: 'chn_1' },
            kind: 'generic',
            topicMode: 'new',
          },
        }),
      );

      await run('edit', ID, '--thread', 'cht_5');

      expect(mockTrpcClient.inboundWebhook.update.mutate).toHaveBeenCalledWith({
        delivery: { channelId: 'chn_1', threadId: 'cht_5' },
        id: ID,
      });
    });

    it('refuses to drop auto-approval while the webhook still posts to a Channel', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(
        generic({
          source: {
            autoApprove: true,
            delivery: { channelId: 'chn_1' },
            kind: 'generic',
            topicMode: 'new',
          },
        }),
      );

      await expect(run('edit', ID, '--no-auto-approve')).rejects.toThrow('exit:1');

      expect(errors()).toContain('--no-channel');
      expect(mockTrpcClient.inboundWebhook.update.mutate).not.toHaveBeenCalled();
    });

    it('requires auto-approval from the current row when adding a Channel', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());

      await expect(run('edit', ID, '--channel', 'chn_1')).rejects.toThrow('exit:1');

      expect(errors()).toContain('needs --auto-approve');
      expect(mockTrpcClient.inboundWebhook.update.mutate).not.toHaveBeenCalled();
    });

    it('needs at least one change', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());

      await expect(run('edit', ID)).rejects.toThrow('exit:1');

      expect(errors()).toContain('Nothing to change');
    });

    it('renames without touching the identifier', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());
      mockTrpcClient.inboundWebhook.update.mutate.mockResolvedValue(generic({ name: 'Deploys' }));

      await run('edit', ID, '--name', 'Deploys');

      expect(mockTrpcClient.inboundWebhook.update.mutate).toHaveBeenCalledWith({
        id: ID,
        name: 'Deploys',
      });
      expect(output()).toMatch(/Identifier\s+ci-alerts \(unchanged\)/);
    });

    it('refuses an MCP Events subscription, pointing at lh automation rename', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(mcpEvents());

      await expect(run('edit', MCP_ID, '--name', 'Web bugs')).rejects.toThrow('exit:1');

      expect(errors()).toContain(`lh automation rename ${MCP_ID} <name>`);
      expect(mockTrpcClient.inboundWebhook.update.mutate).not.toHaveBeenCalled();
    });
  });

  describe('pause / resume', () => {
    it('pauses and resumes a custom webhook', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());
      mockTrpcClient.inboundWebhook.update.mutate.mockResolvedValue(generic({ status: 'paused' }));

      await run('pause', ID);
      await run('resume', ID);

      expect(mockTrpcClient.inboundWebhook.update.mutate).toHaveBeenNthCalledWith(1, {
        id: ID,
        paused: true,
      });
      expect(mockTrpcClient.inboundWebhook.update.mutate).toHaveBeenNthCalledWith(2, {
        id: ID,
        paused: false,
      });
      expect(output()).toContain(`lh webhook resume ${ID}`);
    });

    it.each(['pause', 'resume'])('%s refuses an MCP Events subscription', async (command) => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(mcpEvents());

      await expect(run(command, MCP_ID)).rejects.toThrow('exit:1');

      expect(errors()).toContain('is an automation (MCP Events subscription)');
      expect(errors()).toContain(`lh automation view ${MCP_ID}`);
      expect(mockTrpcClient.inboundWebhook.update.mutate).not.toHaveBeenCalled();
    });
  });

  describe('rotate-key', () => {
    it('asks first, then prints the new key once', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());
      mockTrpcClient.inboundWebhook.rotateToken.mutate.mockResolvedValue({
        item: generic(),
        secret: SECRET,
      });
      mockConfirm.mockResolvedValue(true);

      await run('rotate-key', ID);

      expect(mockConfirm).toHaveBeenCalledWith(expect.stringContaining('stops working right away'));
      expect(mockTrpcClient.inboundWebhook.rotateToken.mutate).toHaveBeenCalledWith({ id: ID });
      expect(output().split(SECRET)).toHaveLength(2);
    });

    it('does nothing when declined', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());
      mockConfirm.mockResolvedValue(false);

      await run('rotate-key', ID);

      expect(mockTrpcClient.inboundWebhook.rotateToken.mutate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Cancelled.');
    });

    it('skips the prompt with --yes and includes the key in JSON', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());
      mockTrpcClient.inboundWebhook.rotateToken.mutate.mockResolvedValue({
        item: generic(),
        secret: SECRET,
      });

      await run('rotate-key', ID, '--yes', '--json', 'secret');

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(JSON.parse(consoleSpy.mock.calls[0][0])).toEqual({ secret: SECRET });
    });

    it('refuses an MCP Events subscription before asking', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(mcpEvents());

      await expect(run('rotate-key', MCP_ID)).rejects.toThrow('exit:1');

      expect(errors()).toContain('is an automation');
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockTrpcClient.inboundWebhook.rotateToken.mutate).not.toHaveBeenCalled();
    });
  });

  describe('test', () => {
    it('sends a test call', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());
      mockTrpcClient.inboundWebhook.sendTest.mutate.mockResolvedValue({
        accepted: true,
        status: 202,
      });

      await run('test', ID);

      expect(mockTrpcClient.inboundWebhook.sendTest.mutate).toHaveBeenCalledWith({ id: ID });
      expect(output()).toContain('Test sent (HTTP 202)');
    });

    it('fails when the receiver refuses the test call', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());
      mockTrpcClient.inboundWebhook.sendTest.mutate.mockResolvedValue({
        accepted: false,
        error: 'rate_limited',
        status: 429,
      });

      await expect(run('test', ID)).rejects.toThrow('exit:1');

      expect(errors()).toContain('refused (HTTP 429): rate_limited');
    });

    it('asks to resume a paused webhook first', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic({ status: 'paused' }));

      await expect(run('test', ID)).rejects.toThrow('exit:1');

      expect(errors()).toContain(`lh webhook resume ${ID}`);
      expect(mockTrpcClient.inboundWebhook.sendTest.mutate).not.toHaveBeenCalled();
    });

    it('refuses an MCP Events subscription', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(mcpEvents());

      await expect(run('test', MCP_ID)).rejects.toThrow('exit:1');

      expect(errors()).toContain('is an automation');
      expect(mockTrpcClient.inboundWebhook.sendTest.mutate).not.toHaveBeenCalled();
    });
  });

  describe('calls', () => {
    const call = (n: number) => ({
      id: `sig_${n}`,
      payloadPurged: false,
      preview: `{"n":${n}}`,
      reason: n === 1 ? 'webhook_paused' : null,
      receivedAt: '2026-11-17T10:00:00.000Z',
      status: n === 1 ? ('ignored' as const) : ('processed' as const),
      test: n === 0,
      threadKey: null,
      topic: n === 1 ? null : { id: 'tpc_1', title: 'Build failures' },
    });
    const page = (from: number, count: number, next?: boolean) => ({
      items: Array.from({ length: count }, (_, i) => call(from + i)),
      ...(next && { nextCursor: { createdAt: `2026-11-17T09:00:0${from}.000000Z`, id: ID } }),
    });

    beforeEach(() => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());
    });

    it('refuses an MCP Events subscription', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(mcpEvents());

      await expect(run('calls', MCP_ID)).rejects.toThrow('exit:1');

      expect(errors()).toContain('is an automation');
      expect(mockTrpcClient.inboundWebhook.listDeliveries.query).not.toHaveBeenCalled();
    });

    it('shows the first page and says when more exist', async () => {
      mockTrpcClient.inboundWebhook.listDeliveries.query.mockResolvedValueOnce(page(0, 20, true));

      await run('calls', ID);

      expect(mockTrpcClient.inboundWebhook.listDeliveries.query).toHaveBeenCalledTimes(1);
      expect(mockTrpcClient.inboundWebhook.listDeliveries.query).toHaveBeenCalledWith({ id: ID });
      const text = output();
      expect(text).toContain('Skipped: the webhook was paused');
      expect(text).toContain('Build failures');
      expect(text).toContain('(test)');
      expect(text).toContain('--limit <n> or --all');
    });

    it('follows the cursor until --limit is reached', async () => {
      mockTrpcClient.inboundWebhook.listDeliveries.query
        .mockResolvedValueOnce(page(0, 20, true))
        .mockResolvedValueOnce(page(20, 20, true));

      await run('calls', ID, '--limit', '25', '--json', 'id');

      expect(mockTrpcClient.inboundWebhook.listDeliveries.query).toHaveBeenNthCalledWith(2, {
        cursor: { createdAt: '2026-11-17T09:00:00.000000Z', id: ID },
        id: ID,
      });
      expect(JSON.parse(consoleSpy.mock.calls[0][0])).toHaveLength(25);
    });

    it('reads every page with --all', async () => {
      mockTrpcClient.inboundWebhook.listDeliveries.query
        .mockResolvedValueOnce(page(0, 20, true))
        .mockResolvedValueOnce(page(20, 20, true))
        .mockResolvedValueOnce(page(40, 3));

      await run('calls', ID, '--all', '--json');

      expect(mockTrpcClient.inboundWebhook.listDeliveries.query).toHaveBeenCalledTimes(3);
      expect(JSON.parse(consoleSpy.mock.calls[0][0])).toHaveLength(43);
    });

    it('rejects a bad --limit', async () => {
      await expect(run('calls', ID, '--limit', '0')).rejects.toThrow('exit:1');

      expect(mockTrpcClient.inboundWebhook.listDeliveries.query).not.toHaveBeenCalled();
    });

    it('says when there are no calls', async () => {
      mockTrpcClient.inboundWebhook.listDeliveries.query.mockResolvedValue({ items: [] });

      await run('calls', ID);

      expect(consoleSpy).toHaveBeenCalledWith('No calls yet.');
    });
  });

  describe('delete', () => {
    it('confirms, then deletes a custom webhook', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());
      mockConfirm.mockResolvedValue(true);

      await run('delete', ID);

      expect(mockConfirm).toHaveBeenCalledWith(expect.stringContaining('URL stops working'));
      expect(mockTrpcClient.inboundWebhook.delete.mutate).toHaveBeenCalledWith({ id: ID });
    });

    it('refuses an MCP Events subscription before asking', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(mcpEvents());

      await expect(run('delete', MCP_ID)).rejects.toThrow('exit:1');

      expect(errors()).toContain(`lh automation delete ${MCP_ID}`);
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockTrpcClient.inboundWebhook.delete.mutate).not.toHaveBeenCalled();
    });

    it('does nothing when declined', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());
      mockConfirm.mockResolvedValue(false);

      await run('delete', ID);

      expect(mockTrpcClient.inboundWebhook.delete.mutate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Cancelled.');
    });

    it('skips the prompt with --yes', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());

      await run('delete', ID, '--yes');

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockTrpcClient.inboundWebhook.delete.mutate).toHaveBeenCalledWith({ id: ID });
    });

    it('surfaces a forbidden error', async () => {
      mockTrpcClient.inboundWebhook.get.query.mockResolvedValue(generic());
      mockTrpcClient.inboundWebhook.delete.mutate.mockRejectedValue(
        new Error('Only the creator or a workspace owner or admin can delete this webhook.'),
      );

      await expect(run('delete', ID, '--yes')).rejects.toThrow('exit:1');

      expect(errorSpy).toHaveBeenCalledWith(
        'Only the creator or a workspace owner or admin can delete this webhook.',
      );
    });
  });
});

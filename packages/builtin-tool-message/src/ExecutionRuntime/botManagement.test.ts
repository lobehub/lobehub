import { describe, expect, it, vi } from 'vitest';

import { MessageExecutionRuntime } from './index';
import type { BotProviderQuery } from './types';

const runtimeWith = (botProvider?: Partial<BotProviderQuery>) =>
  new MessageExecutionRuntime({
    botProvider: botProvider as BotProviderQuery | undefined,
    service: {} as any,
  });

type Call = [method: keyof MessageExecutionRuntime, params: any, provider: keyof BotProviderQuery];

const calls: Call[] = [
  ['listPlatforms', {}, 'listPlatforms'],
  ['listBots', {}, 'listBots'],
  ['getBotDetail', { botId: 'b1' }, 'getBotDetail'],
  [
    'createBot',
    { agentId: 'a', applicationId: 'x', credentials: {}, platform: 'discord' },
    'createBot',
  ],
  ['updateBot', { botId: 'b1', settings: {} }, 'updateBot'],
  ['deleteBot', { botId: 'b1' }, 'deleteBot'],
  ['toggleBot', { botId: 'b1', enabled: true }, 'toggleBot'],
  ['connectBot', { botId: 'b1' }, 'connectBot'],
  ['listMessengers', {}, 'listMessengers'],
  ['getMessengerDetail', { installationId: 'i1' }, 'getMessengerDetail'],
  ['uninstallMessenger', { installationId: 'i1' }, 'uninstallMessenger'],
  ['listMessengerPlatforms', {}, 'listMessengerPlatforms'],
  ['listMessengerLinks', {}, 'listMessengerLinks'],
  ['setMessengerActiveAgent', { agentId: 'a1', platform: 'slack' }, 'setMessengerActiveAgent'],
  ['unlinkMessenger', { platform: 'slack' }, 'unlinkMessenger'],
  ['sendMessengerPush', { content: 'hi', platform: 'telegram' }, 'sendMessengerPush'],
];

const invoke = (runtime: MessageExecutionRuntime, method: Call[0], params: unknown) =>
  (runtime[method] as (p: unknown) => Promise<any>).call(runtime, params);

describe('MessageExecutionRuntime bot management', () => {
  it.each(calls)('%s fails cleanly without a bot provider', async (method, params) => {
    const output = await invoke(runtimeWith(), method, params);

    expect(output.success).toBe(false);
    expect(output.content).toMatch(/not available/);
  });

  it.each(calls)('%s reports a provider error instead of throwing', async (method, params, fn) => {
    const output = await invoke(
      runtimeWith({ [fn]: vi.fn().mockRejectedValue(new Error('boom')) }),
      method,
      params,
    );

    expect(output).toEqual({ content: `${method} error: boom`, success: false });
  });

  it('lists platforms with their required credentials', async () => {
    const output = await runtimeWith({
      listPlatforms: vi.fn().mockResolvedValue([
        {
          credentialFields: [
            { key: 'botToken', required: true },
            { key: 'note', required: false },
          ],
          id: 'discord',
          name: 'Discord',
        },
        { credentialFields: [], id: 'wechat', name: 'WeChat' },
      ]),
    }).listPlatforms({});

    expect(output.content).toBe(
      '2 supported platform(s):\n- **Discord** (discord) — requires: botToken\n- **WeChat** (wechat)',
    );
  });

  it('lists bots, and says so when there are none', async () => {
    const listBots = vi
      .fn()
      .mockResolvedValueOnce([
        { enabled: true, id: 'b1', platform: 'discord', serverId: 's1', userId: 'u1' },
      ]);
    listBots.mockResolvedValueOnce([]);
    const runtime = runtimeWith({ listBots });

    expect((await runtime.listBots({})).content).toBe(
      '1 configured bot(s):\n- discord (platform: discord, botId: b1, enabled: true, status: unknown, serverId: s1, userId: u1)',
    );
    expect((await runtime.listBots({})).content).toMatch(/^No bots configured/);
  });

  it('describes one bot, or reports it missing', async () => {
    const getBotDetail = vi
      .fn()
      .mockResolvedValueOnce({
        applicationId: 'app1',
        enabled: false,
        id: 'b1',
        platform: 'discord',
        runtimeStatus: 'connected',
        settings: { a: 1 },
      })
      .mockResolvedValueOnce(null);
    const runtime = runtimeWith({ getBotDetail });

    expect((await runtime.getBotDetail({ botId: 'b1' })).content).toBe(
      'Bot b1:\n- Platform: discord\n- App ID: app1\n- Enabled: false\n- Status: connected\n- Settings: {"a":1}',
    );
    expect(await runtime.getBotDetail({ botId: 'b2' })).toEqual({
      content: 'Bot not found: b2',
      success: false,
    });
  });

  it('confirms bot writes', async () => {
    const runtime = runtimeWith({
      connectBot: vi.fn().mockResolvedValue({ status: 'connecting' }),
      createBot: vi.fn().mockResolvedValue({ id: 'b9', platform: 'slack' }),
      deleteBot: vi.fn().mockResolvedValue(undefined),
      toggleBot: vi.fn().mockResolvedValue(undefined),
      updateBot: vi.fn().mockResolvedValue(undefined),
    });

    expect((await runtime.createBot(calls[3][1])).content).toBe('Created slack bot (id: b9)');
    expect((await runtime.updateBot({ botId: 'b1' })).content).toBe('Updated bot b1');
    expect((await runtime.deleteBot({ botId: 'b1' })).content).toBe('Deleted bot b1');
    expect((await runtime.toggleBot({ botId: 'b1', enabled: false })).content).toBe(
      'Bot b1 disabled',
    );
    expect((await runtime.connectBot({ botId: 'b1' })).content).toBe(
      'Bot connection initiated (status: connecting)',
    );
  });
});

describe('MessageExecutionRuntime messenger management', () => {
  it('lists messenger installs, and points to settings when there are none', async () => {
    const listMessengers = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'i1',
          installedAt: new Date('2026-10-01T00:00:00Z'),
          platform: 'slack',
          tenantName: 'Acme',
        },
        { id: 'i2', platform: 'feishu', tenantId: 't2' },
      ])
      .mockResolvedValueOnce([]);
    const runtime = runtimeWith({ listMessengers });

    expect((await runtime.listMessengers({})).content).toBe(
      '2 System Bot connection(s):\n- installationId: i1, platform: slack, tenant: Acme, installedAt: 2026-10-01T00:00:00.000Z\n- installationId: i2, platform: feishu, tenantId: t2',
    );
    expect((await runtime.listMessengers({})).content).toMatch(/^No System Bot connections/);
  });

  it('describes one install, or reports it missing', async () => {
    const getMessengerDetail = vi
      .fn()
      .mockResolvedValueOnce({
        applicationId: 'app',
        id: 'i1',
        installedAt: '2026-10-01',
        platform: 'slack',
        revokedAt: null,
        scope: 'bot',
        tenantId: '',
        tenantName: 'Acme',
      })
      .mockResolvedValueOnce(null);
    const runtime = runtimeWith({ getMessengerDetail });

    expect((await runtime.getMessengerDetail({ installationId: 'i1' })).content).toBe(
      'installationId: i1\nplatform: slack\ntenantId: (global)\ntenant: Acme\napplicationId: app\nscope: bot\ninstalledAt: 2026-10-01\nrevoked: no',
    );
    expect((await runtime.getMessengerDetail({ installationId: 'i9' })).success).toBe(false);
  });

  it('lists install platforms and account links', async () => {
    const runtime = runtimeWith({
      listMessengerLinks: vi
        .fn()
        .mockResolvedValueOnce([
          { activeAgentId: null, platform: 'slack', platformUsername: 'arvin', tenantId: 't1' },
        ])
        .mockResolvedValueOnce([]),
      listMessengerPlatforms: vi
        .fn()
        .mockResolvedValueOnce([{ appId: 'A1', botUsername: 'lobe', id: 'slack', name: 'Slack' }])
        .mockResolvedValueOnce([]),
    });

    expect((await runtime.listMessengerPlatforms({})).content).toContain(
      '- slack (Slack) appId: A1 botUsername: lobe',
    );
    expect((await runtime.listMessengerPlatforms({})).content).toMatch(/^No System Bot platforms/);
    expect((await runtime.listMessengerLinks({})).content).toBe(
      '1 System Bot link(s):\n- platform: slack, tenantId: t1, activeAgentId: (none), platformUser: arvin',
    );
    expect((await runtime.listMessengerLinks({})).content).toMatch(/^No System Bot account links/);
  });

  it('confirms messenger writes', async () => {
    const runtime = runtimeWith({
      setMessengerActiveAgent: vi.fn().mockResolvedValue(undefined),
      uninstallMessenger: vi.fn().mockResolvedValue(undefined),
      unlinkMessenger: vi.fn().mockResolvedValue(undefined),
    });

    expect((await runtime.uninstallMessenger({ installationId: 'i1' })).content).toBe(
      'System Bot connection i1 disconnected.',
    );
    expect(
      (await runtime.setMessengerActiveAgent({ agentId: null, platform: 'slack', tenantId: 't1' }))
        .content,
    ).toBe('Active agent for slack (tenant t1) cleared.');
    expect((await runtime.unlinkMessenger({ platform: 'telegram' })).content).toBe(
      'Unlinked your account from telegram. The workspace install is unaffected.',
    );
  });
});

describe('MessageExecutionRuntime.sendMessengerPush', () => {
  it.each([
    ['sent', true, /pushed to the user's telegram DM/],
    ['queued', true, /queued/],
    ['unlinked', false, /no linked telegram account/],
    ['unavailable', false, /currently unavailable/],
  ])('maps status %s', async (status, success, content) => {
    const output = await runtimeWith({
      sendMessengerPush: vi.fn().mockResolvedValue({ status }),
    }).sendMessengerPush({ content: 'hi', platform: 'telegram' });

    expect(output.success).toBe(success);
    expect(output.content).toMatch(content);
  });

  it('reports the remaining WeChat quota', async () => {
    const output = await runtimeWith({
      sendMessengerPush: vi.fn().mockResolvedValue({ remaining: 3, status: 'sent' }),
    }).sendMessengerPush({ content: 'hi', platform: 'wechat' });

    expect(output.content).toBe(
      "Message pushed to the user's wechat DM (3 sends left in the current WeChat window).",
    );
  });

  it('asks which Slack workspace when the user linked several', async () => {
    const sendMessengerPush = vi.fn();
    const output = await runtimeWith({
      listMessengerLinks: vi.fn().mockResolvedValue([
        { platform: 'slack', tenantId: 't1' },
        { platform: 'slack', tenantId: 't2' },
      ]),
      listMessengers: vi
        .fn()
        .mockResolvedValue([{ platform: 'slack', tenantId: 't1', tenantName: 'Acme' }]),
      sendMessengerPush,
    }).sendMessengerPush({ content: 'hi', platform: 'slack' });

    expect(sendMessengerPush).not.toHaveBeenCalled();
    expect(output.state.status).toBe('needs_workspace_selection');
    expect(output.content).toContain('- Acme (tenantId: t1)\n- t2 (tenantId: t2)');
  });

  it('pushes to the only linked Slack workspace', async () => {
    const sendMessengerPush = vi.fn().mockResolvedValue({ status: 'sent' });
    await runtimeWith({
      listMessengerLinks: vi.fn().mockResolvedValue([{ platform: 'slack', tenantId: 't1' }]),
      sendMessengerPush,
    }).sendMessengerPush({ content: 'hi', platform: 'slack' });

    expect(sendMessengerPush).toHaveBeenCalledWith({
      content: 'hi',
      platform: 'slack',
      tenantId: 't1',
    });
  });
});

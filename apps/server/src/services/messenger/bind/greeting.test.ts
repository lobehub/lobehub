// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { composeBindGreeting, greetAfterBind, resolveGreetingLanguage } from './greeting';

const mocks = vi.hoisted(() => ({
  agentRows: [] as unknown[],
  sendMessengerPush: vi.fn(),
}));

vi.mock('../push', () => ({ sendMessengerPush: mocks.sendMessengerPush }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));

const serverDB = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.agentRows }) }) }),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agentRows = [];
  mocks.sendMessengerPush.mockResolvedValue({ status: 'sent' });
});

describe('resolveGreetingLanguage', () => {
  it('follows the locale of the page that started the bind', () => {
    expect(resolveGreetingLanguage('telegram', 'zh-CN')).toBe('zh');
    expect(resolveGreetingLanguage('wechat', 'en-US')).toBe('en');
  });

  it('falls back to Chinese on WeChat and English elsewhere', () => {
    expect(resolveGreetingLanguage('wechat')).toBe('zh');
    expect(resolveGreetingLanguage('slack')).toBe('en');
  });
});

describe('composeBindGreeting', () => {
  it("uses the agent's own opening message verbatim", () => {
    expect(
      composeBindGreeting({
        agent: { name: 'Toby', openingMessage: '  Yo! Toby here.  ' },
        language: 'en',
        platform: 'telegram',
      }),
    ).toBe('Yo! Toby here.');
  });

  it('introduces the agent by its personal name on the bound platform', () => {
    expect(
      composeBindGreeting({
        agent: { name: '小托', title: 'Assistant' },
        language: 'zh',
        platform: 'wechat',
      }),
    ).toBe(
      '嗨，我是 小托 👋 我们在 微信 上连上了。以后有什么事直接在这里发给我就行，我看到就回你。',
    );
  });

  it('labels the untitled inbox agent as LobeAI', () => {
    expect(composeBindGreeting({ agent: undefined, language: 'en', platform: 'linq' })).toBe(
      "Hi, I'm LobeAI 👋 We're connected on iMessage now. Message me here anytime and I'll get back to you.",
    );
  });
});

describe('greetAfterBind', () => {
  it('pushes the greeting into the freshly bound chat', async () => {
    mocks.agentRows = [{ name: 'Toby', openingMessage: null, title: null }];

    const outcome = await greetAfterBind({
      agentId: 'agent-toby',
      locale: 'en-US',
      platform: 'slack',
      serverDB,
      tenantId: 'T1',
      userId: 'user-1',
    });

    expect(outcome).toBe('sent');
    expect(mocks.sendMessengerPush).toHaveBeenCalledWith({
      content:
        "Hi, I'm Toby 👋 We're connected on Slack now. Message me here anytime and I'll get back to you.",
      platform: 'slack',
      serverDB,
      tenantId: 'T1',
      userId: 'user-1',
    });
  });

  it('escapes an opening message for Telegram HTML parse mode', async () => {
    mocks.agentRows = [{ name: 'Toby', openingMessage: 'Hi <3 & welcome', title: null }];

    await greetAfterBind({ agentId: 'agent-toby', platform: 'telegram', serverDB, userId: 'u' });

    expect(mocks.sendMessengerPush).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Hi &lt;3 &amp; welcome' }),
    );
  });

  it('reports a WeChat greeting waiting for the send window as queued', async () => {
    mocks.sendMessengerPush.mockResolvedValue({ reason: 'window_closed', status: 'queued' });

    await expect(
      greetAfterBind({ agentId: null, platform: 'wechat', serverDB, userId: 'user-1' }),
    ).resolves.toBe('queued');
  });

  it('never throws — a failed greeting must not fail the bind', async () => {
    mocks.sendMessengerPush.mockRejectedValue(new Error('network down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      greetAfterBind({ agentId: null, platform: 'telegram', serverDB, userId: 'user-1' }),
    ).resolves.toBe('failed');
    consoleError.mockRestore();
  });
});

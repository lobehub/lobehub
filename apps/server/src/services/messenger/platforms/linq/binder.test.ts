// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { greetAfterBind } from '../../bind/greeting';
import { linkLinqSenderByCode, LINQ_REPLY, MessengerLinqBinder } from './binder';

const mocks = vi.hoisted(() => ({
  consumeLinkCode: vi.fn(),
  restoreLinkCode: vi.fn(),
  findByPlatformUser: vi.fn(),
  sendText: vi.fn(),
  sendToHandle: vi.fn(),
  settleLinkCode: vi.fn(),
  upsertForPlatform: vi.fn(),
}));

vi.mock('@/config/messenger', () => ({
  getMessengerLinqConfig: vi.fn(async () => ({
    apiKey: 'linq_test',
    numbers: ['+15550000001', '+15550000002'],
    webhookSecret: 'whsec_test',
  })),
}));

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://app.test' } }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));

vi.mock('@/database/models/messengerAccountLink', () => {
  class MessengerAccountLinkConflictError extends Error {}
  class MessengerAccountLinkRelinkRequiredError extends Error {}
  class MessengerAccountLinkModel {
    static findByPlatformUser = mocks.findByPlatformUser;
    constructor(
      _db: unknown,
      public userId: string,
    ) {}
    upsertForPlatform = (params: unknown) => mocks.upsertForPlatform(this.userId, params);
  }
  return {
    MessengerAccountLinkConflictError,
    MessengerAccountLinkModel,
    MessengerAccountLinkRelinkRequiredError,
  };
});

vi.mock('../../bind/greeting', () => ({ greetAfterBind: vi.fn() }));

vi.mock('../../linkTokenStore', () => ({
  consumeLinkCode: mocks.consumeLinkCode,
  restoreLinkCode: mocks.restoreLinkCode,
  settleLinkCode: mocks.settleLinkCode,
}));

vi.mock('@lobechat/agent-address-linq', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    LinqApiClient: class {
      sendText = mocks.sendText;
      sendToHandle = mocks.sendToHandle;
      startTyping = vi.fn();
    },
  };
});

const SENDER = '+15550001111';

const unlinked = (text: string) => ({
  authorUserId: SENDER,
  chatId: 'chat_1',
  message: { text } as any,
});

const pendingCode = {
  activeAgentId: 'agt_inbox',
  createdAt: 0,
  platform: 'linq',
  pollId: 'poll_1',
  userId: 'user_alice',
  workspaceId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findByPlatformUser.mockResolvedValue(undefined);
  mocks.upsertForPlatform.mockResolvedValue({ id: 'link_1' });
});

describe('MessengerLinqBinder.handleUnlinkedMessage', () => {
  it('binds the sender to whoever issued the code, then confirms in the chat', async () => {
    mocks.consumeLinkCode.mockResolvedValue(pendingCode);

    await new MessengerLinqBinder().handleUnlinkedMessage(unlinked('Link me LH-7Q2M4XKP'));

    expect(mocks.consumeLinkCode).toHaveBeenCalledWith('LH-7Q2M4XKP', 'linq');
    expect(mocks.upsertForPlatform).toHaveBeenCalledWith('user_alice', {
      activeAgentId: 'agt_inbox',
      platform: 'linq',
      platformUserId: SENDER,
      platformUsername: SENDER,
      tenantId: '',
      workspaceId: null,
    });
    expect(mocks.settleLinkCode).toHaveBeenCalledWith(
      'poll_1',
      expect.objectContaining({ platformUserId: SENDER, status: 'linked' }),
    );
    expect(mocks.sendText).toHaveBeenCalledWith('chat_1', LINQ_REPLY.linked());
    expect(greetAfterBind).toHaveBeenCalledWith({
      agentId: 'agt_inbox',
      locale: undefined,
      platform: 'linq',
      userId: 'user_alice',
    });
  });

  it('points a cold message without a code at the connect page and binds nothing', async () => {
    await new MessengerLinqBinder().handleUnlinkedMessage(unlinked('hello?'));

    expect(mocks.consumeLinkCode).not.toHaveBeenCalled();
    expect(mocks.upsertForPlatform).not.toHaveBeenCalled();
    expect(mocks.sendText).toHaveBeenCalledWith(
      'chat_1',
      expect.stringContaining('https://app.test/settings/messenger/linq'),
    );
  });

  it('rejects an expired or already-used code', async () => {
    mocks.consumeLinkCode.mockResolvedValue(null);

    await new MessengerLinqBinder().handleUnlinkedMessage(unlinked('LH-7Q2M4XKP'));

    expect(mocks.upsertForPlatform).not.toHaveBeenCalled();
    expect(mocks.sendText).toHaveBeenCalledWith('chat_1', LINQ_REPLY.codeInvalid);
  });

  it('refuses to move a phone that already belongs to another account', async () => {
    mocks.consumeLinkCode.mockResolvedValue(pendingCode);
    mocks.findByPlatformUser.mockResolvedValue({ userId: 'user_bob' });

    await new MessengerLinqBinder().handleUnlinkedMessage(unlinked('LH-7Q2M4XKP'));

    expect(mocks.upsertForPlatform).not.toHaveBeenCalled();
    expect(mocks.settleLinkCode).toHaveBeenCalledWith('poll_1', {
      reason: 'already_linked_to_other',
      status: 'failed',
    });
    expect(mocks.sendText).toHaveBeenCalledWith('chat_1', LINQ_REPLY.alreadyLinkedToOther);
  });
});

describe('linkLinqSenderByCode', () => {
  it('puts the consumed code back when the bind fails unexpectedly', async () => {
    mocks.consumeLinkCode.mockResolvedValue(pendingCode);
    mocks.restoreLinkCode.mockResolvedValue(undefined);
    mocks.upsertForPlatform.mockRejectedValue(new Error('connection reset'));

    await expect(linkLinqSenderByCode('LH-7Q2M4XKP', SENDER)).rejects.toThrow('connection reset');

    expect(mocks.restoreLinkCode).toHaveBeenCalledWith('LH-7Q2M4XKP', pendingCode);
    // Nothing settled — the polling page stays pending, not failed or linked.
    expect(mocks.settleLinkCode).not.toHaveBeenCalled();
  });

  it('keeps a committed link when settling the poll status fails afterwards', async () => {
    mocks.consumeLinkCode.mockResolvedValue(pendingCode);
    mocks.settleLinkCode.mockRejectedValueOnce(new Error('redis timeout'));

    await expect(linkLinqSenderByCode('LH-7Q2M4XKP', SENDER)).resolves.toEqual({
      payload: pendingCode,
      status: 'linked',
    });
    expect(mocks.upsertForPlatform).toHaveBeenCalledTimes(1);
    // The sender is linked now — resurrecting the code would strand it.
    expect(mocks.restoreLinkCode).not.toHaveBeenCalled();
  });

  it('does not restore a code whose outcome was a definitive conflict', async () => {
    mocks.consumeLinkCode.mockResolvedValue(pendingCode);
    mocks.findByPlatformUser.mockResolvedValue({ userId: 'user_bob' });

    await expect(linkLinqSenderByCode('LH-7Q2M4XKP', SENDER)).resolves.toEqual({
      status: 'already_linked_to_other',
    });
    expect(mocks.restoreLinkCode).not.toHaveBeenCalled();
  });
});

describe('MessengerLinqBinder.sendDmText', () => {
  it('sends to a handle through the pool when given a phone number', async () => {
    await new MessengerLinqBinder().sendDmText(SENDER, 'hi');
    expect(mocks.sendToHandle).toHaveBeenCalledWith({ handle: SENDER, text: 'hi' });
    expect(mocks.sendText).not.toHaveBeenCalled();
  });
});

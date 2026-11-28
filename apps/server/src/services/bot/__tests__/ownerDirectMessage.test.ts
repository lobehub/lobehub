import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendBotOwnerDirectMessage } from '../ownerDirectMessage';

const mockSendMessage = vi.hoisted(() => vi.fn());
const mockSendDirectMessage = vi.hoisted(() => vi.fn());
const mockCreateService = vi.hoisted(() => vi.fn());
const mockLarkSend = vi.hoisted(() => vi.fn());
const mockLarkCtor = vi.hoisted(() => vi.fn());
const mockWeComDeliver = vi.hoisted(() => vi.fn());
const mockResolveWeComOutbound = vi.hoisted(() => vi.fn());

vi.mock('../messageTarget', () => ({ createMessageServiceForCredentials: mockCreateService }));
vi.mock('../platforms/wecom/outbound', () => ({
  resolveWeComOutbound: mockResolveWeComOutbound,
}));
vi.mock('@lobechat/chat-adapter-feishu', () => ({
  LarkApiClient: vi.fn(function (...args: unknown[]) {
    mockLarkCtor(...args);
    return { sendMessage: mockLarkSend };
  }),
}));

const base = { applicationId: 'app-1', content: 'Heads up', credentials: { appSecret: 's' } };

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateService.mockReturnValue({
    sendDirectMessage: mockSendDirectMessage,
    sendMessage: mockSendMessage,
  });
  mockResolveWeComOutbound.mockReturnValue({ deliver: mockWeComDeliver });
});

describe('sendBotOwnerDirectMessage', () => {
  it('opens a Discord DM with the owner', async () => {
    await expect(
      sendBotOwnerDirectMessage({ ...base, ownerId: '123', platform: 'discord' }),
    ).resolves.toBe(true);
    expect(mockSendDirectMessage).toHaveBeenCalledWith({
      content: 'Heads up',
      platform: 'discord',
      userId: '123',
    });
  });

  it('posts to the Slack app DM by user ID', async () => {
    await sendBotOwnerDirectMessage({ ...base, ownerId: 'U1', platform: 'slack' });
    expect(mockSendMessage).toHaveBeenCalledWith({
      channelId: 'U1',
      content: 'Heads up',
      platform: 'slack',
    });
  });

  it('refuses a Slack channel ID so the notice never lands in a channel', async () => {
    await expect(
      sendBotOwnerDirectMessage({ ...base, ownerId: 'C0123', platform: 'slack' }),
    ).resolves.toBe(false);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('pushes a WeCom single-chat message to the userid over the bot connection', async () => {
    await expect(
      sendBotOwnerDirectMessage({ ...base, ownerId: 'zhangsan', platform: 'wecom' }),
    ).resolves.toBe(true);
    expect(mockResolveWeComOutbound).toHaveBeenCalledWith('app-1');
    expect(mockWeComDeliver).toHaveBeenCalledWith({ id: 'zhangsan', type: 'single' }, 'Heads up');
  });

  it.each(['feishu', 'lark'])('sends a %s message to the open_id', async (platform) => {
    await sendBotOwnerDirectMessage({ ...base, ownerId: 'ou_1', platform });
    expect(mockLarkCtor).toHaveBeenCalledWith('app-1', 's', platform);
    expect(mockLarkSend).toHaveBeenCalledWith('ou_1', 'Heads up', 'open_id');
  });

  it('sends a DingTalk one-to-one message', async () => {
    await sendBotOwnerDirectMessage({ ...base, ownerId: 'staff-1', platform: 'dingtalk' });
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'single:staff-1' }),
    );
  });

  it('sends a QQ active C2C message to an openid', async () => {
    await sendBotOwnerDirectMessage({ ...base, ownerId: 'A1B2C3', platform: 'qq' });
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'c2c:A1B2C3' }),
    );
  });

  it('skips a QQ number, which the bot API cannot address', async () => {
    await expect(
      sendBotOwnerDirectMessage({ ...base, ownerId: '123456789', platform: 'qq' }),
    ).resolves.toBe(false);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('skips platforms without owner DMs and blank owner IDs', async () => {
    await expect(
      sendBotOwnerDirectMessage({ ...base, ownerId: '1', platform: 'telegram' }),
    ).resolves.toBe(false);
    await expect(
      sendBotOwnerDirectMessage({ ...base, ownerId: '  ', platform: 'discord' }),
    ).resolves.toBe(false);
    expect(mockCreateService).not.toHaveBeenCalled();
  });
});

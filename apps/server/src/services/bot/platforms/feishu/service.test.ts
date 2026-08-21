// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockApi = vi.hoisted(() => ({
  sendDirectMessage: vi.fn(),
}));

vi.mock('@lobechat/chat-adapter-feishu', () => ({
  LarkApiClient: vi.fn().mockImplementation(() => mockApi),
}));

// Prevent @lobechat/builtin-tool-message/executionRuntime from pulling in
// app-wide i18n / store modules that don't resolve in the node test env.
vi.mock('@lobechat/builtin-tool-message/executionRuntime', () => ({}));

const { FeishuMessageService } = await import('./service');

describe('FeishuMessageService.sendDirectMessage', () => {
  let service: InstanceType<typeof FeishuMessageService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FeishuMessageService(mockApi as any, 'feishu');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to api.sendDirectMessage and returns channelId from raw.chat_id', async () => {
    mockApi.sendDirectMessage.mockResolvedValue({
      messageId: 'om_dm_001',
      raw: { chat_id: 'oc_dm_chat', message_id: 'om_dm_001' },
    });

    const result = await service.sendDirectMessage({
      content: 'hello',
      platform: 'feishu',
      userId: 'ou_user1',
    });

    expect(mockApi.sendDirectMessage).toHaveBeenCalledWith('ou_user1', 'hello');
    expect(result).toEqual({
      channelId: 'oc_dm_chat',
      messageId: 'om_dm_001',
      platform: 'feishu',
    });
  });

  it('falls back to userId when raw has no chat_id', async () => {
    mockApi.sendDirectMessage.mockResolvedValue({
      messageId: 'om_dm_002',
      raw: { message_id: 'om_dm_002' },
    });

    const result = await service.sendDirectMessage({
      content: 'hi',
      platform: 'feishu',
      userId: 'on_user2',
    });

    expect(result.channelId).toBe('on_user2');
  });

  it('uses lark as platform name when constructed with lark', async () => {
    const larkService = new FeishuMessageService(mockApi as any, 'lark');

    mockApi.sendDirectMessage.mockResolvedValue({
      messageId: 'om_dm_003',
      raw: { chat_id: 'oc_lark_dm' },
    });

    const result = await larkService.sendDirectMessage({
      content: 'test',
      platform: 'lark',
      userId: 'ou_lark',
    });

    expect(result.platform).toBe('lark');
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockApi = vi.hoisted(() => ({
  editMessage: vi.fn(),
  sendDirectMessage: vi.fn(),
  sendMessage: vi.fn(),
}));

const mockSendFeishuAttachments = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/chat-adapter-feishu', () => ({
  LarkApiClient: vi.fn().mockImplementation(() => mockApi),
}));

vi.mock('./sendAttachments', () => ({
  sendFeishuAttachments: mockSendFeishuAttachments,
}));

// Prevent @lobechat/builtin-tool-message/executionRuntime from pulling in
// app-wide i18n / store modules that don't resolve in the node test env.
vi.mock('@lobechat/builtin-tool-message/executionRuntime', () => ({}));

const { FeishuMessageService } = await import('./service');

describe('FeishuMessageService message round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses text transport so a sent message can be edited consistently', async () => {
    mockApi.sendMessage.mockResolvedValue({ messageId: 'om_text_1', raw: {} });
    const service = new FeishuMessageService(mockApi as any, 'feishu');

    const sent = await service.sendMessage({
      channelId: 'oc_chat',
      content: 'hello',
      platform: 'feishu',
    });
    await service.editMessage({
      channelId: 'oc_chat',
      content: 'updated',
      messageId: sent.messageId!,
      platform: 'feishu',
    });

    expect(mockApi.sendMessage).toHaveBeenCalledWith('oc_chat', 'hello');
    expect(mockApi.editMessage).toHaveBeenCalledWith('om_text_1', 'updated');
  });
});

describe('FeishuMessageService.sendDirectMessage', () => {
  let service: InstanceType<typeof FeishuMessageService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendFeishuAttachments.mockResolvedValue(['om_att_1']);
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

  // The tool manifest exposes `attachments` on
  // sendDirectMessage — silently dropping them made generated images/files
  // requested for a DM never reach the recipient.
  it('sends attachments into the resolved chat after the text leg', async () => {
    mockApi.sendDirectMessage.mockResolvedValue({
      messageId: 'om_dm_004',
      raw: { chat_id: 'oc_dm_chat' },
    });
    mockSendFeishuAttachments.mockResolvedValue(['om_att_1']);
    const attachments = [{ mimeType: 'image/png', name: 'img.png', type: 'image' }] as any;

    await service.sendDirectMessage({
      attachments,
      content: 'see this',
      platform: 'feishu',
      userId: 'ou_user1',
    });

    expect(mockApi.sendDirectMessage).toHaveBeenCalledWith('ou_user1', 'see this');
    expect(mockSendFeishuAttachments).toHaveBeenCalledWith(mockApi, 'oc_dm_chat', attachments);
  });

  it('sends attachments directly to the user when text reveals no chat_id', async () => {
    mockApi.sendDirectMessage.mockResolvedValue({
      messageId: 'om_dm_005',
      raw: { message_id: 'om_dm_005' },
    });

    await service.sendDirectMessage({
      attachments: [{ type: 'image' }] as any,
      content: 'hi',
      platform: 'feishu',
      userId: 'ou_user1',
    });

    expect(mockSendFeishuAttachments).toHaveBeenCalledWith(
      mockApi,
      'ou_user1',
      [{ type: 'image' }],
      undefined,
      true,
    );
  });

  it('sends an attachment-only DM without an empty text request', async () => {
    const attachments = [{ type: 'image' }] as any;

    const result = await service.sendDirectMessage({
      attachments,
      content: '',
      platform: 'feishu',
      userId: 'ou_user1',
    });

    expect(mockApi.sendDirectMessage).not.toHaveBeenCalled();
    expect(mockSendFeishuAttachments).toHaveBeenCalledWith(
      mockApi,
      'ou_user1',
      attachments,
      undefined,
      true,
    );
    expect(result.messageId).toBe('om_att_1');
  });

  it('fails an attachment-only DM when no attachment was delivered', async () => {
    mockSendFeishuAttachments.mockResolvedValue([]);

    await expect(
      service.sendDirectMessage({
        attachments: [{ type: 'image' }] as any,
        content: '',
        platform: 'feishu',
        userId: 'ou_user1',
      }),
    ).rejects.toThrow('delivered no attachments');
  });

  it('fails a text DM when none of its requested attachments were delivered', async () => {
    mockApi.sendDirectMessage.mockResolvedValue({
      messageId: 'om_dm_006',
      raw: { chat_id: 'oc_dm_chat' },
    });
    mockSendFeishuAttachments.mockResolvedValue([]);

    await expect(
      service.sendDirectMessage({
        attachments: [{ type: 'image' }] as any,
        content: 'see this',
        platform: 'feishu',
        userId: 'ou_user1',
      }),
    ).rejects.toThrow('delivered no attachments');
  });
});

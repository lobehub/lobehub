import { RateLimitError } from 'chat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDingTalkAdapter, DingTalkAdapter } from './adapter';
import { DingTalkApiError } from './api';
import { signCallback } from './crypto';
import type { DingTalkRawMessage } from './types';

// ---- fixtures (shapes from the robot receive-message callback) ----

const SECRET = 'test_secret';
const BOT_ID = '$:LWCP_v1:$bot';

function singleText(overrides: Partial<DingTalkRawMessage> = {}): DingTalkRawMessage {
  return {
    chatbotCorpId: 'ding_corp',
    chatbotUserId: BOT_ID,
    conversationId: 'cid_single==',
    conversationType: '1',
    createAt: 1_793_000_000_000,
    isAdmin: false,
    msgId: 'msg_single_1',
    msgtype: 'text',
    robotCode: 'ding_client',
    senderCorpId: 'ding_corp',
    senderId: '$:LWCP_v1:$user',
    senderNick: '张三',
    senderStaffId: 'staff_1',
    sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=s1',
    sessionWebhookExpiredTime: Date.now() + 90 * 60 * 1000,
    text: { content: ' 你好 ' },
    ...overrides,
  };
}

function groupAt(overrides: Partial<DingTalkRawMessage> = {}): DingTalkRawMessage {
  return singleText({
    atUsers: [{ dingtalkId: BOT_ID }],
    conversationId: 'cidGroupABC+/=',
    conversationTitle: '研发群',
    conversationType: '2',
    isInAtList: true,
    msgId: 'msg_group_1',
    sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=g1',
    text: { content: ' 帮我总结一下' },
    ...overrides,
  });
}

function signedRequest(body: unknown, secret = SECRET, timestamp = String(Date.now())): Request {
  return new Request('http://localhost/api/agent/webhooks/dingtalk/app', {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'sign': signCallback(timestamp, secret),
      'timestamp': timestamp,
    },
    method: 'POST',
  });
}

describe('DingTalkAdapter', () => {
  let adapter: DingTalkAdapter;
  let api: any;

  const mockChat = {
    getLogger: vi.fn(() => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
    getUserName: vi.fn(() => 'TestBot'),
    processMessage: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    adapter = new DingTalkAdapter({ clientId: 'ding_client', clientSecret: SECRET });
    api = adapter.apiClient;
    vi.spyOn(api, 'getAccessToken').mockResolvedValue('tok');
    await adapter.initialize(mockChat as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function receive(raw: DingTalkRawMessage) {
    const res = await adapter.handleWebhook(signedRequest(raw));
    expect(res.status).toBe(200);
    const call = mockChat.processMessage.mock.calls.at(-1);
    return { message: call ? await call[2]() : undefined, res, threadId: call?.[1] };
  }

  describe('basics', () => {
    it('defaults userName and robotCode', () => {
      const a = createDingTalkAdapter({ clientId: 'cid', clientSecret: 's' });
      expect(a.userName).toBe('dingtalk-bot');
      expect(a.apiClient.robotCode).toBe('cid');
      expect(
        new DingTalkAdapter({ clientId: 'c', clientSecret: 's', robotCode: 'r' }).apiClient
          .robotCode,
      ).toBe('r');
    });

    it('validates credentials on initialize', () => {
      expect(api.getAccessToken).toHaveBeenCalled();
      expect(adapter.userName).toBe('TestBot');
    });

    it('round-trips thread ids, keeping ":" inside the id', () => {
      expect(adapter.encodeThreadId({ id: 'staff_1', type: 'single' })).toBe(
        'dingtalk:single:staff_1',
      );
      expect(adapter.decodeThreadId('dingtalk:group:cid:with:colon')).toEqual({
        id: 'cid:with:colon',
        type: 'group',
      });
      expect(adapter.isDM('dingtalk:single:staff_1')).toBe(true);
      expect(adapter.isDM('dingtalk:group:cid')).toBe(false);
    });
  });

  describe('inbound: webhook authentication', () => {
    it('rejects an unsigned request', async () => {
      const req = new Request('http://localhost/x', {
        body: JSON.stringify(singleText()),
        method: 'POST',
      });
      const res = await adapter.handleWebhook(req);
      expect(res.status).toBe(401);
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });

    it('rejects a request signed with another secret', async () => {
      const res = await adapter.handleWebhook(signedRequest(singleText(), 'other'));
      expect(res.status).toBe(401);
    });

    it('rejects a stale timestamp (> 1 hour)', async () => {
      const old = String(Date.now() - 2 * 60 * 60 * 1000);
      const res = await adapter.handleWebhook(signedRequest(singleText(), SECRET, old));
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid JSON with a valid signature', async () => {
      const res = await adapter.handleWebhook(signedRequest('{oops'));
      expect(res.status).toBe(400);
    });
  });

  describe('inbound: message parsing', () => {
    it('parses a single-chat text message', async () => {
      const { message, threadId } = await receive(singleText());

      expect(threadId).toBe('dingtalk:single:staff_1');
      expect(message.text).toBe('你好');
      expect(message.isMention).toBe(false);
      expect(message.author).toMatchObject({
        fullName: '张三',
        isBot: false,
        isMe: false,
        userId: 'staff_1',
      });
      expect(message.id).toBe('msg_single_1');
      expect(message.metadata.dateSent.getTime()).toBe(1_793_000_000_000);
    });

    it('parses a group @robot message as a mention on the conversation thread', async () => {
      const { message, threadId } = await receive(groupAt());

      expect(threadId).toBe('dingtalk:group:cidGroupABC+/=');
      expect(message.text).toBe('帮我总结一下');
      expect(message.isMention).toBe(true);
      expect(adapter.botUserId).toBe(BOT_ID);
    });

    it('falls back to senderId when the sender has no staffId (external user)', async () => {
      const { threadId, message } = await receive(singleText({ senderStaffId: undefined }));
      expect(threadId).toBe('dingtalk:single:$:LWCP_v1:$user');
      expect(message.author.userId).toBe('$:LWCP_v1:$user');
    });

    it('maps richText to text plus image attachments', async () => {
      const { message } = await receive(
        singleText({
          content: {
            richText: [
              { text: '看这张图 ' },
              { downloadCode: 'dc_img', type: 'picture' },
              { text: '是什么？' },
            ],
          },
          msgtype: 'richText',
          text: undefined,
        }),
      );

      expect(message.text).toBe('看这张图 是什么？');
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0]).toMatchObject({
        fetchMetadata: { downloadCode: 'dc_img' },
        type: 'image',
      });
    });

    it('maps a picture message to an image attachment that downloads via downloadCode', async () => {
      const download = vi.spyOn(api, 'downloadFile').mockResolvedValue(Buffer.from('img'));
      const { message } = await receive(
        singleText({ content: { downloadCode: 'dc_pic' }, msgtype: 'picture', text: undefined }),
      );

      expect(message.text).toBe('');
      expect(message.attachments[0].type).toBe('image');
      await expect(message.attachments[0].fetchData!()).resolves.toEqual(Buffer.from('img'));
      expect(download).toHaveBeenCalledWith('dc_pic');
    });

    it('uses the speech recognition text for audio messages', async () => {
      const { message } = await receive(
        singleText({
          content: { downloadCode: 'dc_a', duration: 3, recognition: '明天开会' },
          msgtype: 'audio',
          text: undefined,
        }),
      );
      expect(message.text).toBe('明天开会');
      expect(message.attachments[0].type).toBe('audio');
    });

    it('maps file messages with a MIME type from the file name', async () => {
      const { message } = await receive(
        singleText({
          content: { downloadCode: 'dc_f', fileName: 'report.pdf' },
          msgtype: 'file',
          text: undefined,
        }),
      );
      expect(message.attachments[0]).toMatchObject({
        mimeType: 'application/pdf',
        name: 'report.pdf',
        type: 'file',
      });
    });

    it('maps video messages to a video attachment', async () => {
      const { message } = await receive(
        singleText({ content: { downloadCode: 'dc_v' }, msgtype: 'video', text: undefined }),
      );
      expect(message.attachments[0].type).toBe('video');
    });

    it('drops empty messages and unknown types without text', async () => {
      await adapter.handleWebhook(signedRequest(singleText({ text: { content: '   ' } })));
      await adapter.handleWebhook(
        signedRequest(singleText({ msgtype: 'interactiveCard', text: undefined })),
      );
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });

    it('ignores messages sent by the robot itself and payloads without ids', async () => {
      await adapter.handleWebhook(signedRequest(singleText({ senderId: BOT_ID })));
      await adapter.handleWebhook(signedRequest({ hello: 'world' }));
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });
  });

  describe('outbound', () => {
    it('replies through the sessionWebhook while it is valid', async () => {
      const reply = vi.spyOn(api, 'replyViaSessionWebhook').mockResolvedValue(undefined);
      const batch = vi.spyOn(api, 'sendSingleMessage');
      await receive(singleText());

      const sent = await adapter.postMessage('dingtalk:single:staff_1', 'hello');

      expect(reply).toHaveBeenCalledWith(
        'https://oapi.dingtalk.com/robot/sendBySession?session=s1',
        { msgKey: 'sampleText', msgParam: { content: 'hello' } },
      );
      expect(batch).not.toHaveBeenCalled();
      expect(sent.threadId).toBe('dingtalk:single:staff_1');
    });

    it('sends single chat via batchSend when there is no sessionWebhook', async () => {
      const batch = vi
        .spyOn(api, 'sendSingleMessage')
        .mockResolvedValue({ processQueryKey: 'pqk_1' });

      const sent = await adapter.postMessage('dingtalk:single:staff_9', {
        markdown: '**结论**：可以',
      });

      expect(batch).toHaveBeenCalledWith(['staff_9'], {
        msgKey: 'sampleMarkdown',
        msgParam: { text: '**结论**：可以', title: '结论：可以' },
      });
      expect(sent.id).toBe('pqk_1');
      expect(sent.raw.conversationType).toBe('1');
    });

    it('sends group chat via groupMessages/send with the openConversationId', async () => {
      const group = vi
        .spyOn(api, 'sendGroupMessage')
        .mockResolvedValue({ processQueryKey: 'pqk_g' });

      const sent = await adapter.postMessage('dingtalk:group:cidGroupABC+/=', 'done');

      expect(group).toHaveBeenCalledWith('cidGroupABC+/=', {
        msgKey: 'sampleText',
        msgParam: { content: 'done' },
      });
      expect(sent.id).toBe('pqk_g');
      expect(sent.raw.conversationType).toBe('2');
    });

    it('falls back to the OpenAPI when the sessionWebhook is rejected, then stops using it', async () => {
      const reply = vi.spyOn(api, 'replyViaSessionWebhook').mockRejectedValue(
        new DingTalkApiError({
          code: '300001',
          kind: 'session_webhook',
          message: 'expired',
          status: 200,
        }),
      );
      const group = vi.spyOn(api, 'sendGroupMessage').mockResolvedValue({ processQueryKey: 'pqk' });
      await receive(groupAt());

      await adapter.postMessage('dingtalk:group:cidGroupABC+/=', 'first');
      await adapter.postMessage('dingtalk:group:cidGroupABC+/=', 'second');

      expect(reply).toHaveBeenCalledTimes(1);
      expect(group).toHaveBeenCalledTimes(2);
    });

    it('skips a sessionWebhook that has passed sessionWebhookExpiredTime', async () => {
      const reply = vi.spyOn(api, 'replyViaSessionWebhook');
      const batch = vi
        .spyOn(api, 'sendSingleMessage')
        .mockResolvedValue({ processQueryKey: 'pqk' });
      await receive(singleText({ sessionWebhookExpiredTime: Date.now() + 1000 }));

      await adapter.postMessage('dingtalk:single:staff_1', 'late reply');

      expect(reply).not.toHaveBeenCalled();
      expect(batch).toHaveBeenCalledWith(['staff_1'], expect.anything());
    });

    it('maps a DingTalk rate limit to the chat SDK RateLimitError', async () => {
      vi.spyOn(api, 'sendGroupMessage').mockRejectedValue(
        new DingTalkApiError({
          code: 'send.too.fast',
          kind: 'rate_limit',
          message: 'slow down',
          status: 400,
        }),
      );

      const error = await adapter.postMessage('dingtalk:group:cid', 'x').catch((e) => e);
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.cause).toBeInstanceOf(DingTalkApiError);
    });

    it('surfaces other API errors unchanged', async () => {
      const original = new DingTalkApiError({
        code: 'invalidParameter.robotCode.notExsit',
        kind: 'invalid_request',
        message: 'bad robot',
        status: 400,
      });
      vi.spyOn(api, 'sendGroupMessage').mockRejectedValue(original);

      await expect(adapter.postMessage('dingtalk:group:cid', 'x')).rejects.toBe(original);
    });

    it('edits by posting a new message', async () => {
      const group = vi.spyOn(api, 'sendGroupMessage').mockResolvedValue({ processQueryKey: 'p2' });
      const sent = await adapter.editMessage('dingtalk:group:cid', 'p1', 'updated');
      expect(group).toHaveBeenCalled();
      expect(sent.id).toBe('p2');
    });

    it('sends images by URL', async () => {
      const group = vi.spyOn(api, 'sendGroupMessage').mockResolvedValue({ processQueryKey: 'p' });
      await adapter.postImage('dingtalk:group:cid', 'https://example.com/a.png');
      expect(group).toHaveBeenCalledWith('cid', {
        msgKey: 'sampleImageMsg',
        msgParam: { photoURL: 'https://example.com/a.png' },
      });
    });
  });

  describe('end-to-end over fetch: expired token is refreshed during a send', () => {
    it('retries the group send with a fresh token', async () => {
      vi.mocked(api.getAccessToken).mockRestore();
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json({ accessToken: 'old', expireIn: 7200 }))
        .mockResolvedValueOnce(json({ code: 'InvalidAuthentication' }, 401))
        .mockResolvedValueOnce(json({ accessToken: 'new', expireIn: 7200 }))
        .mockResolvedValueOnce(json({ processQueryKey: 'pqk_ok' }));
      vi.stubGlobal('fetch', fetchMock);
      api.invalidateAccessToken();

      const sent = await adapter.postMessage('dingtalk:group:cid', 'hi');

      expect(sent.id).toBe('pqk_ok');
      expect(fetchMock.mock.calls[3][1].headers['x-acs-dingtalk-access-token']).toBe('new');
    });
  });

  describe('gateway listener', () => {
    it('forwards callbacks that handleWebhook accepts (shared signature scheme)', async () => {
      class WS {
        static OPEN = 1;
        static last: WS;
        readyState = 1;
        sent: string[] = [];
        private l = new Map<string, Array<(e: any) => void>>();
        constructor(public url: string) {
          WS.last = this;
          setTimeout(() => this.emit('open', {}), 0);
        }
        addEventListener(e: string, f: (e: any) => void) {
          this.l.set(e, [...(this.l.get(e) || []), f]);
        }
        removeEventListener() {}
        send(d: string) {
          this.sent.push(d);
        }
        close() {
          this.readyState = 3;
          this.emit('close', { code: 1000, reason: '' });
        }
        emit(e: string, d: any) {
          for (const f of this.l.get(e) || []) f(d);
        }
      }
      vi.stubGlobal('WebSocket', WS);
      vi.spyOn(api, 'openStreamConnection').mockResolvedValue({
        endpoint: 'wss://e/connect',
        ticket: 'tk',
      });

      let forwarded: Request | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit) => {
          forwarded = new Request(url, init);
          return new Response('ok');
        }),
      );

      const controller = new AbortController();
      await adapter.startGatewayListener(
        { waitUntil: vi.fn() },
        60_000,
        controller.signal,
        'http://localhost/hook',
      );

      WS.last.emit('message', {
        data: JSON.stringify({
          data: JSON.stringify(groupAt()),
          headers: { messageId: 'm', topic: '/v1.0/im/bot/messages/get' },
          type: 'CALLBACK',
        }),
      });
      await vi.waitFor(() => expect(forwarded).toBeDefined());

      const res = await adapter.handleWebhook(forwarded!);
      expect(res.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledWith(
        adapter,
        'dingtalk:group:cidGroupABC+/=',
        expect.any(Function),
        undefined,
      );
      controller.abort();
    });
  });
});

import { createCipheriv, randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWeComAdapter, extractWeComText } from './adapter';
import { WeComLongConnection } from './connection';
import {
  decryptWeComMedia,
  signForwardedFrame,
  verifyForwardedFrame,
  WECOM_SIGNATURE_HEADER,
  WECOM_TIMESTAMP_HEADER,
} from './crypto';
import { registerWeComConnection, unregisterWeComConnection } from './registry';
import { FakeWeComServerSocket, flush } from './testUtils';
import type { WeComFrame, WeComMessageBody } from './types';
import { WECOM_CMD } from './types';

const SECRET = 'bot-secret';

const frameOf = (body: Partial<WeComMessageBody>, reqId = 'req-1'): WeComFrame => ({
  body: {
    aibotid: 'bot-1',
    chattype: 'single',
    from: { userid: 'zhangsan' },
    msgid: 'msg-1',
    msgtype: 'text',
    text: { content: 'hello' },
    ...body,
  },
  cmd: WECOM_CMD.MSG_CALLBACK,
  headers: { req_id: reqId },
});

const signedRequest = (frame: unknown, secret = SECRET, timestamp = String(Date.now())) => {
  const body = JSON.stringify(frame);
  return new Request('https://app.example.com/api/agent/webhooks/wecom/bot-1', {
    body,
    headers: {
      [WECOM_SIGNATURE_HEADER]: signForwardedFrame(secret, timestamp, body),
      [WECOM_TIMESTAMP_HEADER]: timestamp,
    },
    method: 'POST',
  });
};

const initAdapter = async () => {
  const adapter = createWeComAdapter({ botId: 'bot-1', secret: SECRET });
  const processMessage = vi.fn();
  await adapter.initialize({
    getLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
    getUserName: () => 'lobe-bot',
    processMessage,
  } as any);
  return { adapter, processMessage };
};

describe('WeComAdapter.handleWebhook', () => {
  it('rejects frames without a valid signature', async () => {
    const { adapter, processMessage } = await initAdapter();

    const unsigned = new Request('https://x/', {
      body: JSON.stringify(frameOf({})),
      method: 'POST',
    });
    expect((await adapter.handleWebhook(unsigned)).status).toBe(401);
    expect((await adapter.handleWebhook(signedRequest(frameOf({}), 'other'))).status).toBe(401);
    const stale = String(Date.now() - 10 * 60 * 1000);
    expect((await adapter.handleWebhook(signedRequest(frameOf({}), SECRET, stale))).status).toBe(
      401,
    );
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('routes a DM into the chat pipeline on a single-chat thread', async () => {
    const { adapter, processMessage } = await initAdapter();

    const res = await adapter.handleWebhook(signedRequest(frameOf({})));
    expect(res.status).toBe(200);
    expect(processMessage).toHaveBeenCalledTimes(1);

    const [, threadId, factory] = processMessage.mock.calls[0];
    expect(threadId).toBe('wecom:single:zhangsan');
    const message = await factory();
    expect(message.text).toBe('hello');
    expect(message.author.userId).toBe('zhangsan');
    expect(message.raw.reqId).toBe('req-1');
    expect(message.isMention).toBeFalsy();
  });

  it('routes a group @-mention as a mention on the group thread, without the @name', async () => {
    const { adapter, processMessage } = await initAdapter();

    await adapter.handleWebhook(
      signedRequest(
        frameOf({ chatid: 'wrkSFfCgAA', chattype: 'group', text: { content: '@助手 总结一下' } }),
      ),
    );
    const [, threadId, factory] = processMessage.mock.calls[0];
    expect(threadId).toBe('wecom:group:wrkSFfCgAA');
    const message = await factory();
    expect(message.text).toBe('总结一下');
    expect(message.isMention).toBe(true);
    expect(adapter.isDM(threadId)).toBe(false);
  });

  it('ignores events, other bots, and empty messages', async () => {
    const { adapter, processMessage } = await initAdapter();

    await adapter.handleWebhook(
      signedRequest({ ...frameOf({}), body: { event: {} }, cmd: WECOM_CMD.EVENT_CALLBACK }),
    );
    await adapter.handleWebhook(signedRequest(frameOf({ aibotid: 'bot-2' })));
    await adapter.handleWebhook(signedRequest(frameOf({ text: { content: '   ' } })));
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('keeps image-only messages and exposes the image as an attachment', async () => {
    const { adapter, processMessage } = await initAdapter();

    await adapter.handleWebhook(
      signedRequest(
        frameOf({
          image: { aeskey: 'k', url: 'https://img/1' },
          msgtype: 'image',
          text: undefined,
        }),
      ),
    );
    const message = await processMessage.mock.calls[0][2]();
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({ type: 'image', url: 'https://img/1' });
  });

  it('prefixes a quoted message as a blockquote', async () => {
    const { adapter, processMessage } = await initAdapter();
    await adapter.handleWebhook(
      signedRequest(frameOf({ quote: { msgtype: 'text', text: { content: '原文' } } })),
    );
    const message = await processMessage.mock.calls[0][2]();
    expect(message.text).toBe('> 原文\n\nhello');
  });
});

describe('WeComAdapter outbound', () => {
  let connection: WeComLongConnection | undefined;
  afterEach(() => {
    if (connection) {
      unregisterWeComConnection(connection);
      connection.stop();
    }
    connection = undefined;
  });

  it('fails clearly when this process does not hold the connection', async () => {
    const { adapter } = await initAdapter();
    await expect(adapter.postMessage('wecom:single:zhangsan', 'hi')).rejects.toThrow(
      /no live long connection/,
    );
  });

  it('streams: startTyping opens the bubble and postMessage finishes it', async () => {
    let socket!: FakeWeComServerSocket;
    connection = new WeComLongConnection({
      botId: 'bot-1',
      createSocket: (url) => (socket = new FakeWeComServerSocket(url)),
      fetchImpl: (async () => new Response('ok')) as unknown as typeof fetch,
      secret: SECRET,
      webhookUrl: 'https://x/',
    });
    await connection.start();
    registerWeComConnection(connection);
    socket.serverSend(frameOf({}, 'req-7'));
    await flush();

    const { adapter } = await initAdapter();
    await adapter.startTyping('wecom:single:zhangsan');
    const sent = await adapter.postMessage('wecom:single:zhangsan', { markdown: '**答**' });

    const replies = socket.sentWith(WECOM_CMD.RESPOND);
    expect(replies.map((f) => f.body.stream.finish)).toEqual([false, true]);
    expect(replies[1].body.stream.content).toContain('**答**');
    expect(sent.id).toBe(replies[0].body.stream.id);
  });
});

describe('thread ids and text', () => {
  it('round-trips thread ids and rejects foreign ones', async () => {
    const { adapter } = await initAdapter();
    expect(adapter.decodeThreadId(adapter.encodeThreadId({ id: 'a:b', type: 'single' }))).toEqual({
      id: 'a:b',
      type: 'single',
    });
    expect(() => adapter.decodeThreadId('qq:group:1')).toThrow();
  });

  it('extracts text from voice and mixed messages', () => {
    expect(
      extractWeComText({ voice: { content: '语音转写' }, msgtype: 'voice' } as WeComMessageBody),
    ).toBe('语音转写');
    expect(
      extractWeComText({
        mixed: {
          msg_item: [
            { msgtype: 'text', text: { content: 'a' } },
            { image: { url: 'u' }, msgtype: 'image' },
            { msgtype: 'text', text: { content: 'b' } },
          ],
        },
        msgtype: 'mixed',
      } as WeComMessageBody),
    ).toBe('a\nb');
  });
});

describe('crypto', () => {
  it('verifies its own signatures only', () => {
    const ts = String(Date.now());
    const sig = signForwardedFrame(SECRET, ts, 'body');
    expect(verifyForwardedFrame(SECRET, ts, sig, 'body')).toBe(true);
    expect(verifyForwardedFrame(SECRET, ts, sig, 'body2')).toBe(false);
    expect(verifyForwardedFrame(SECRET, ts, 'zz', 'body')).toBe(false);
    expect(verifyForwardedFrame(SECRET, null, sig, 'body')).toBe(false);
  });

  it('decrypts media encrypted the WeCom way (AES-256-CBC, PKCS#7 to 32 bytes)', () => {
    const key = randomBytes(32);
    const plain = Buffer.from('hello wecom media');
    const pad = 32 - (plain.length % 32);
    const padded = Buffer.concat([plain, Buffer.alloc(pad, pad)]);
    const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

    expect(decryptWeComMedia(encrypted, key.toString('base64')).toString()).toBe(
      'hello wecom media',
    );
    expect(() => decryptWeComMedia(encrypted, randomBytes(16).toString('base64'))).toThrow();
  });
});

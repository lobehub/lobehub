// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  buildLinqDeepLink,
  createLinqLinkCode,
  extractLinqLinkCode,
  signLinqWebhookPayload,
} from '@lobechat/agent-address-linq';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentAccounts, agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { AgentAccountService } from '../index';
import { createLinqProvider } from '../providers/linq';
import { AgentAccountProviderRegistry } from '../registry';

/**
 * End-to-end evidence run for the **phone** link: the whole path a Linq number
 * travels, with nothing stubbed in-process.
 *
 * The service talks to the real `@lobechat/agent-address-linq` REST client over
 * a loopback HTTP server (a stand-in for the Linq partner account operations
 * has not provisioned yet — that account and its number are the prerequisite
 * this task names as missing), against the real Drizzle model on the PGlite
 * test database and the real AES-GCM KeyVaults gatekeeper. Webhook deliveries
 * are signed with the real Standard Webhooks HMAC.
 *
 * The five capabilities the task contract names are each asserted below:
 *   开通   provision    — step 1
 *   深链   deep link    — steps 2 + 5 (code minted, pre-filled, extracted back)
 *   入站验签 inbound     — steps 3, 4, 7, 8, 9 (signed / replayed / forged)
 *   纯文本降级 plain text — step 6 (asserted on the bytes that go on the wire)
 *   释放   release      — step 10 (inbound stops routing, send is refused)
 *
 * The invariant that shapes the whole flow is the anti-ban one: LobeHub never
 * opens a chat with a number that has not messaged it first, so the person's
 * first inbound message is what the link is completed by.
 */

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'linq-phone-chain-user';
const agentId = 'linq-phone-chain-agent';

/** The operator-provisioned LobeHub Linq number (deployment config). */
const LINQ_NUMBER = '+15550002222';
/** The person's own phone. */
const HUMAN_NUMBER = '+15550001111';
const WEBHOOK_SECRET = 'whsec_bGluZV9waG9uZV9jaGFpbg==';

/** The deployment clock, frozen so signature tolerance is deterministic. */
const NOW = Date.parse('2026-10-02T00:00:00.000Z');
const TIMESTAMP = Math.floor(NOW / 1000);

interface LnxCall {
  body?: any;
  method: string;
  path: string;
}

/** A loopback stand-in for the Linq partner account (api.linqapp.com/v3). */
const startMockLinq = async () => {
  const calls: LnxCall[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const method = req.method ?? 'GET';
      const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1');
      const raw = Buffer.concat(chunks).toString('utf8');
      calls.push({ body: raw ? JSON.parse(raw) : undefined, method, path: pathname });

      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      // `sendToHandle` looks the chat up first. Returning one is what keeps the
      // reply inside the conversation the person opened — never a cold open.
      if (method === 'GET' && pathname === '/v3/chats') {
        return json(200, { chats: [{ id: 'chat_phone_1' }] });
      }
      if (method === 'POST' && pathname === '/v3/chats/chat_phone_1/messages') {
        return json(200, { chat_id: 'chat_phone_1', message: { id: 'msg_out_phone_1' } });
      }

      return json(404, { error: { message: `unexpected ${method} ${pathname}` } });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return { calls, server, baseUrl: `http://127.0.0.1:${port}/v3` };
};

/** A `message.received` delivery as Linq serializes it. */
const inboundBody = (params: { deliveryId: string; text: string; to?: string }) =>
  JSON.stringify({
    data: {
      chat: { id: 'chat_phone_1' },
      id: params.deliveryId,
      parts: [{ type: 'text', value: params.text }],
      sender_handle: { handle: HUMAN_NUMBER },
      sent_at: new Date(NOW).toISOString(),
      to: params.to ?? LINQ_NUMBER,
    },
    event_type: 'message.received',
  });

/** Sign a delivery exactly as Linq does (Standard Webhooks). */
const signedInbound = (params: { deliveryId: string; raw: string; secret?: string }) => ({
  body: params.raw,
  headers: {
    'webhook-id': params.deliveryId,
    'webhook-signature': signLinqWebhookPayload({
      body: params.raw,
      id: params.deliveryId,
      secret: params.secret ?? WEBHOOK_SECRET,
      timestamp: TIMESTAMP,
    }),
    'webhook-timestamp': String(TIMESTAMP),
  },
});

let mock: Awaited<ReturnType<typeof startMockLinq>>;
let gateKeeper: KeyVaultsGateKeeper;
let service: AgentAccountService;

beforeAll(async () => {
  // A real 32-byte AES-GCM key, matching how the deployment builds the
  // gatekeeper, so the credential path is the production one.
  vi.stubEnv('KEY_VAULTS_SECRET', Buffer.alloc(32, 9).toString('base64'));
  gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  mock = await startMockLinq();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    mock.server.close((error) => (error ? reject(error) : resolve())),
  );
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  mock.calls.length = 0;
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values({ id: agentId, userId });

  const registry = new AgentAccountProviderRegistry().register(
    createLinqProvider({
      apiBaseUrl: mock.baseUrl,
      apiKey: 'linq_phone_e2e',
      fromNumber: LINQ_NUMBER,
      now: () => NOW,
      webhookSecret: WEBHOOK_SECRET,
    }),
  );

  service = new AgentAccountService(serverDB, userId, { gateKeeper, registry });
});

afterEach(async () => {
  await serverDB.delete(agentAccounts);
  await serverDB.delete(users);
});

describe('Linq phone chain — end to end over loopback', () => {
  it('provisions, links by deep link, receives, replies in plain text and releases', async () => {
    const transcript: string[] = [];

    // ---------------------------------------------------------------- 1. 开通
    const phone = await service.provision({ agentId, displayName: 'Toby phone', provider: 'linq' });
    transcript.push(
      `1. provision(linq) -> ${phone.identifier} kind=${phone.kind} provider=${phone.provider} ` +
        `capabilities=${JSON.stringify(phone.capabilities)} status=${phone.status}`,
    );
    expect(phone).toMatchObject({
      capabilities: { receive: true, send: true },
      identifier: LINQ_NUMBER,
      kind: 'phone',
      provider: 'linq',
    });

    // ------------------------------------------------------------- 2. 深链
    // The binding flow mints a one-time code and hands the person a link that
    // pre-fills it; nothing is sent to the person's phone by LobeHub.
    const code = createLinqLinkCode();
    const link = buildLinqDeepLink({
      code,
      message: 'Link my LobeHub agent',
      number: phone.identifier,
    });
    transcript.push(`2. deep link -> ${link!.sms}`);
    transcript.push(`   deep link -> ${link!.imessage}`);
    expect(link!.number).toBe(LINQ_NUMBER);
    expect(link!.body).toBe(`Link my LobeHub agent ${code}`);

    // --------------------------------- 3+4. 用户先发 + 入站验签（真实 HMAC）
    // The person taps the link from their own phone. That first message is the
    // only thing that makes LobeHub talk back.
    const firstRaw = inboundBody({ deliveryId: 'delivery_phone_1', text: link!.body! });
    const first = await service.handleInbound(
      'linq',
      signedInbound({
        deliveryId: 'delivery_phone_1',
        raw: firstRaw,
      }),
    );
    if (first.outcome !== 'delivered') throw new Error(`expected delivered, got ${first.outcome}`);
    transcript.push(
      `3. handleInbound(signed) -> ${first.outcome} from=${first.message.from} to=${first.message.to} ` +
        `text=${JSON.stringify(first.message.text)}`,
    );
    expect(first.message).toMatchObject({
      from: HUMAN_NUMBER,
      providerMessageId: 'delivery_phone_1',
      threadKey: 'chat_phone_1',
      to: LINQ_NUMBER,
    });

    // ------------------------------------------------- 5. 深链闭链：取回链接码
    const recovered = extractLinqLinkCode(first.message.text);
    transcript.push(`4. extractLinqLinkCode(inbound text) -> ${recovered} (expected ${code})`);
    expect(recovered).toBe(code);

    // ---------------------------------------- 6. 出站：真实 HTTP + 纯文本降级
    // A Linq text part is delivered verbatim, so the markdown an agent emits
    // must be degraded before it goes on the wire.
    const markdown = '**Linked!** Docs at [lobehub.com/docs](https://lobehub.com/docs)';
    const sent = await service.send(phone.id, { text: markdown, to: HUMAN_NUMBER });
    const sendCall = mock.calls.find((call) => call.method === 'POST');
    const wireText = sendCall?.body?.message?.parts?.[0]?.value;
    transcript.push(
      `5. send(phone) -> providerMessageId=${sent.providerMessageId} via ${sendCall?.method} ${sendCall?.path}`,
    );
    transcript.push(`   markdown in : ${markdown}`);
    transcript.push(`   plain text out: ${wireText}`);
    transcript.push(
      `   wire lookup: ${mock.calls.map((c) => `${c.method} ${c.path}`).join(' | ')}`,
    );
    expect(sent.providerMessageId).toBe('msg_out_phone_1');
    // The reply went into the conversation the person opened, not a new one.
    expect(mock.calls[0]).toMatchObject({ method: 'GET', path: '/v3/chats' });
    expect(wireText).toBe('Linked! Docs at lobehub.com/docs (https://lobehub.com/docs)');
    expect(wireText).not.toContain('**');

    // ------------------------------------------- 7. 重放同一条 webhook-id 被拒
    const replay = await service.handleInbound(
      'linq',
      signedInbound({
        deliveryId: 'delivery_phone_1',
        raw: firstRaw,
      }),
    );
    transcript.push(`6. handleInbound(replay of delivery_phone_1) -> ${replay.outcome}`);
    expect(replay.outcome).toBe('rejected');

    // ---------------------------------------------------- 8. 伪造签名被拒
    const forgedRaw = inboundBody({ deliveryId: 'delivery_phone_2', text: 'spoofed' });
    const forged = await service.handleInbound('linq', {
      body: forgedRaw,
      headers: {
        'webhook-id': 'delivery_phone_2',
        'webhook-signature': 'v1,AAAA',
        'webhook-timestamp': String(TIMESTAMP),
      },
    });
    transcript.push(`7. handleInbound(forged signature) -> ${forged.outcome}`);
    expect(forged.outcome).toBe('rejected');

    // ------------------------- 9. 路由按号码：签名有效但不是我们的号码 → 不投递
    const otherRaw = inboundBody({
      deliveryId: 'delivery_phone_3',
      text: 'wrong number',
      to: '+19998887777',
    });
    const other = await service.handleInbound(
      'linq',
      signedInbound({
        deliveryId: 'delivery_phone_3',
        raw: otherRaw,
      }),
    );
    transcript.push(`8. handleInbound(valid signature, foreign number) -> ${other.outcome}`);
    expect(other.outcome).toBe('unknown-account');

    // ---------------------------------------------------------------- 10. 释放
    await service.revoke(phone.id);
    const released = await service.get(phone.id);
    transcript.push(
      `9. revoke(phone) -> status=${released!.status} hasCredential=${released!.hasCredential} ` +
        `releasedAt=${released!.revokedAt !== null}`,
    );
    expect(released).toMatchObject({ status: 'revoked' });

    // Sending from a released number is refused…
    await expect(
      service.send(phone.id, { text: 'still there?', to: HUMAN_NUMBER }),
    ).rejects.toThrow(/revoked/);
    transcript.push('10. send(released phone) -> refused (account is revoked)');

    // …and — the defect this task fixes — the released number stops *receiving*
    // too, even though the delivery is correctly signed with the deployment
    // secret that is still configured.
    const afterReleaseRaw = inboundBody({
      deliveryId: 'delivery_phone_4',
      text: 'anyone home?',
    });
    const afterRelease = await service.handleInbound(
      'linq',
      signedInbound({
        deliveryId: 'delivery_phone_4',
        raw: afterReleaseRaw,
      }),
    );
    transcript.push(
      `11. handleInbound(valid signature, released number) -> ${afterRelease.outcome} (no longer routed)`,
    );
    expect(afterRelease.outcome).toBe('unknown-account');

    console.log(`\n[linq-phone-chain]\n${transcript.join('\n')}\n[/linq-phone-chain]\n`);
  });
});

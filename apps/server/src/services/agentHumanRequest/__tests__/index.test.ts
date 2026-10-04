// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { type AscRequest, sealSecret, utf8Encode, verifyRequest } from '@lobechat/secret-channel';
import type { AgentAccountOutboundMessage, AgentHumanRequestItem } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentHumanRequests, agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { AgentHumanRequestService, APPROVAL_TTL_MS } from '../index';
import { buildOutcomePrompt } from '../outcomePrompt';

/**
 * The parked-action lifecycle, end to end against a real database, with the
 * provider (sender) and the agent wake (notifier) as recording fakes.
 *
 * The secret tests seal with the reference ASC client (`sealSecret`), exactly
 * what a native client does, and then scan every place the value could leak:
 * the stored row, the item returned to the client, the notice the agent gets.
 */

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'human-request-owner';
const otherUserId = 'human-request-other';
const agentId = 'human-request-agent';
const CODE = '482913';

let sent: { accountId: string; message: AgentAccountOutboundMessage }[] = [];
let notified: AgentHumanRequestItem[] = [];
let sendImpl: (message: AgentAccountOutboundMessage) => Promise<{ providerMessageId: string }>;
let now = Date.now();

const service = async (owner = userId) =>
  new AgentHumanRequestService(serverDB, owner, {
    notifier: { notify: async (item) => void notified.push(item) },
    now: () => now,
    sealer: await KeyVaultsGateKeeper.initWithEnvKey(),
    sender: async (accountId, message) => {
      sent.push({ accountId, message });
      return sendImpl(message);
    },
  });

const origin = { agentId, operationId: 'op-1', toolCallId: 'call-1' };

const action = {
  accountId: 'acc-1',
  channel: 'mail' as const,
  from: 'aria@lobe.id',
  subject: 'Hello',
  text: 'Hi Bob, lunch on Friday?',
  to: 'bob@example.com',
};

const secretAction = {
  ...action,
  subject: 'Re: verify',
  text: `My code is ${AGENT_SLOT()}`,
  threadKey: 'thread-1',
  to: 'verify@service.example',
};

function AGENT_SLOT() {
  return '{{secret}}';
}

const sealFor = async (item: AgentHumanRequestItem, secret = CODE) =>
  sealSecret({
    request: item.secret!.request as unknown as AscRequest,
    secret: utf8Encode(secret),
  });

const rowOf = async (id: string) =>
  (await serverDB.select().from(agentHumanRequests).where(eq(agentHumanRequests.id, id)))[0];

beforeAll(() => {
  vi.stubEnv('KEY_VAULTS_SECRET', Buffer.alloc(32, 7).toString('base64'));
});

beforeEach(async () => {
  sent = [];
  notified = [];
  now = Date.now();
  sendImpl = async () => ({ providerMessageId: `pm-${sent.length}` });

  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values({ id: agentId, userId });
});

describe('approval cards', () => {
  it('parks an outbound message and lists it for the owner, without sending', async () => {
    const svc = await service();
    const item = await svc.requestApproval(origin, action);

    expect(item).toMatchObject({ status: 'pending', type: 'approval' });
    expect(item.action).toMatchObject({ from: 'aria@lobe.id', to: 'bob@example.com' });
    expect(item.expiresAt.getTime()).toBe(now + APPROVAL_TTL_MS);
    expect(sent).toHaveLength(0);

    const pending = await svc.list({ status: ['pending'] });
    expect(pending.map((row) => row.id)).toEqual([item.id]);
  });

  it('sends exactly the edited message, keeps the original, and tells the agent', async () => {
    const svc = await service();
    const item = await svc.requestApproval(origin, action);

    const decided = await svc.decide(
      item.id,
      { action: 'approve', edits: { text: 'Hi Bob, lunch on Thursday instead?' } },
      'ios',
    );

    expect(decided.status).toBe('completed');
    expect(decided.decidedVia).toBe('ios');
    expect(decided.result).toMatchObject({ edited: true, providerMessageId: 'pm-1' });
    expect(decided.originalAction?.text).toBe('Hi Bob, lunch on Friday?');
    expect(sent).toEqual([
      {
        accountId: 'acc-1',
        message: {
          subject: 'Hello',
          text: 'Hi Bob, lunch on Thursday instead?',
          threadKey: undefined,
          to: 'bob@example.com',
        },
      },
    ]);

    expect(notified).toHaveLength(1);
    expect(buildOutcomePrompt(notified[0])).toContain('Hi Bob, lunch on Thursday instead?');
  });

  it('runs the action once when two devices approve at the same moment', async () => {
    const svc = await service();
    const item = await svc.requestApproval(origin, action);

    const results = await Promise.allSettled([
      svc.decide(item.id, { action: 'approve' }, 'ios'),
      svc.decide(item.id, { action: 'approve' }, 'desktop'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('discards without sending', async () => {
    const svc = await service();
    const item = await svc.requestApproval(origin, action);

    const decided = await svc.decide(item.id, { action: 'decline' }, 'web');

    expect(decided.status).toBe('declined');
    expect(sent).toHaveLength(0);
    expect(buildOutcomePrompt(notified[0])).toContain('discarded');
    await expect(svc.decide(item.id, { action: 'approve' })).rejects.toThrow(/already answered/);
  });

  it('records a failed send and lets the owner retry it', async () => {
    const svc = await service();
    const item = await svc.requestApproval(origin, action);

    sendImpl = async () => {
      throw new Error('provider unavailable');
    };
    const failed = await svc.decide(item.id, { action: 'approve' });
    expect(failed).toMatchObject({ result: { error: 'provider unavailable' }, status: 'failed' });

    sendImpl = async () => ({ providerMessageId: 'pm-retry' });
    const retried = await svc.decide(item.id, { action: 'retry' });
    expect(retried).toMatchObject({
      result: { providerMessageId: 'pm-retry' },
      status: 'completed',
    });
    expect(sent).toHaveLength(2);
  });

  it('expires a card that nobody answered and refuses to act on it', async () => {
    const svc = await service();
    const item = await svc.requestApproval(origin, action);

    now += APPROVAL_TTL_MS + 1;

    await expect(svc.decide(item.id, { action: 'approve' })).rejects.toThrow(/expired/);
    expect((await svc.get(item.id)).status).toBe('expired');
    expect(sent).toHaveLength(0);
  });

  it('is invisible to and cannot be decided by another user', async () => {
    const item = await (await service()).requestApproval(origin, action);
    const other = await service(otherUserId);

    await expect(other.get(item.id)).rejects.toThrow(/not found/i);
    await expect(other.decide(item.id, { action: 'approve' })).rejects.toThrow(/not found/i);
    expect(await other.list({})).toEqual([]);
    expect(sent).toHaveLength(0);
  });
});

describe('secure input cards (ASC/1)', () => {
  it('signs the request with the pinned server identity and binds the full action', async () => {
    const svc = await service();
    const item = await svc.requestSecret(origin, { ...secretAction, kind: 'otp' });
    const request = item.secret!.request as unknown as AscRequest;

    // A client pins this fingerprint once and verifies every request against it.
    expect(() =>
      verifyRequest(request, { pinnedFingerprint: svc.identity().identityKeyFp }),
    ).not.toThrow();
    expect(request.kind).toBe('otp');
    expect(item.secret!.label).toBe('verification-code');
    expect(request.purpose.systemObserved).toContain('verify@service.example');
    expect(request.purpose.systemObserved).toContain('«secret:verification-code»');
    expect(request.expiresAt - now).toBe(600_000);
  });

  it('requires the slot exactly once', async () => {
    const svc = await service();
    await expect(
      svc.requestSecret(origin, { ...secretAction, kind: 'otp', text: 'no slot here' }),
    ).rejects.toThrow(/exactly once/);
    await expect(
      svc.requestSecret(origin, { ...secretAction, kind: 'otp', text: '{{secret}} {{secret}}' }),
    ).rejects.toThrow(/exactly once/);
  });

  it('sends the code to the bound recipient and stores, returns and reports none of it', async () => {
    const svc = await service();
    const item = await svc.requestSecret(origin, { ...secretAction, kind: 'otp' });

    const decided = await svc.decide(
      item.id,
      { action: 'fulfill', envelope: await sealFor(item) },
      'ios',
    );

    expect(decided.status).toBe('completed');
    expect(sent).toEqual([
      {
        accountId: 'acc-1',
        message: {
          subject: 'Re: verify',
          text: `My code is ${CODE}`,
          threadKey: 'thread-1',
          to: 'verify@service.example',
        },
      },
    ]);

    const row = await rowOf(item.id);
    expect(row.recipientKey).toBeNull();
    expect(JSON.stringify(row)).not.toContain(CODE);
    expect(JSON.stringify(decided)).not.toContain(CODE);
    expect(JSON.stringify(notified)).not.toContain(CODE);
    expect(buildOutcomePrompt(notified[0])).not.toContain(CODE);
    expect(buildOutcomePrompt(notified[0])).toContain('verification-code');
  });

  it('opens a request at most once', async () => {
    const svc = await service();
    const item = await svc.requestSecret(origin, { ...secretAction, kind: 'otp' });
    const envelope = await sealFor(item);

    await svc.decide(item.id, { action: 'fulfill', envelope });
    await expect(svc.decide(item.id, { action: 'fulfill', envelope })).rejects.toThrow(
      /already answered/,
    );
    expect(sent).toHaveLength(1);
  });

  it('fails closed on an envelope sealed for another request, destroying the key', async () => {
    const svc = await service();
    const item = await svc.requestSecret(origin, { ...secretAction, kind: 'otp' });
    const other = await svc.requestSecret(origin, { ...secretAction, kind: 'otp' });

    const foreign = await sealFor(other);
    const decided = await svc.decide(item.id, {
      action: 'fulfill',
      envelope: { ...foreign, requestId: (item.secret!.request as unknown as AscRequest).id },
    });

    expect(decided.status).toBe('failed');
    expect(decided.result?.error).toMatch(/REQUEST_MISMATCH|DECRYPT_FAILED/);
    expect((await rowOf(item.id)).recipientKey).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('refuses when the stored action changed after the card was shown', async () => {
    const svc = await service();
    const item = await svc.requestSecret(origin, { ...secretAction, kind: 'otp' });

    await serverDB
      .update(agentHumanRequests)
      .set({ action: { ...item.action, to: 'attacker@evil.example' } })
      .where(eq(agentHumanRequests.id, item.id));

    const decided = await svc.decide(item.id, {
      action: 'fulfill',
      envelope: await sealFor(item),
    });

    expect(decided.status).toBe('failed');
    expect(decided.result?.error).toMatch(/changed/);
    expect(sent).toHaveLength(0);
  });

  it('redacts the value from a provider error that echoes it', async () => {
    const svc = await service();
    const item = await svc.requestSecret(origin, { ...secretAction, kind: 'otp' });
    sendImpl = async (message) => {
      throw new Error(`rejected body: ${message.text}`);
    };

    const decided = await svc.decide(item.id, {
      action: 'fulfill',
      envelope: await sealFor(item),
    });

    expect(decided.status).toBe('failed');
    expect(decided.result?.error).toBe('rejected body: My code is «secret:verification-code»');
    expect(JSON.stringify(await rowOf(item.id))).not.toContain(CODE);
  });

  it('skips without sending and drops the key', async () => {
    const svc = await service();
    const item = await svc.requestSecret(origin, { ...secretAction, kind: 'otp' });

    const decided = await svc.decide(item.id, { action: 'decline' }, 'ios');

    expect(decided.status).toBe('declined');
    expect((await rowOf(item.id)).recipientKey).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('refuses an approval-only action on a secret card and vice versa', async () => {
    const svc = await service();
    const secret = await svc.requestSecret(origin, { ...secretAction, kind: 'otp' });
    const approval = await svc.requestApproval(origin, action);

    await expect(svc.decide(secret.id, { action: 'approve' })).rejects.toThrow(/approval/);
    await expect(
      svc.decide(approval.id, { action: 'fulfill', envelope: await sealFor(secret) }),
    ).rejects.toThrow(/secret/);
  });
});

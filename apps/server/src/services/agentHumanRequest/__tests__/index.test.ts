// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { type AscRequest, sealSecret, utf8Encode, verifyRequest } from '@lobechat/secret-channel';
import type { AgentAccountOutboundMessage, AgentHumanRequestItem } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentHumanRequests, agents, users, workspaces } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import {
  AgentHumanRequestService,
  APPROVAL_TTL_MS,
  NOTIFY_REDELIVER_AFTER_MS,
  unavailableSender,
} from '../index';
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
/** How many upcoming wakes fail (the agent run could not be started). */
let failWakes = 0;
let now = Date.now();

const service = async (owner = userId, workspaceId?: string) =>
  new AgentHumanRequestService(serverDB, owner, {
    workspaceId,
    notifier: {
      notify: async (item) => {
        if (failWakes > 0) {
          failWakes -= 1;
          throw new Error('could not start the agent run');
        }
        notified.push(item);
      },
    },
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
  failWakes = 0;
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

  it('lets the owner discard a failed send instead of retrying it', async () => {
    const svc = await service();
    const item = await svc.requestApproval(origin, action);

    sendImpl = async () => {
      throw new Error('provider unavailable');
    };
    expect((await svc.decide(item.id, { action: 'approve' })).status).toBe('failed');

    const discarded = await svc.decide(item.id, { action: 'decline' }, 'web');
    expect(discarded.status).toBe('declined');
    await expect(svc.decide(item.id, { action: 'retry' })).rejects.toThrow(/failed request/);
    expect(sent).toHaveLength(1);
  });

  it('fails an approval instead of pretending to send when no channel is wired', async () => {
    const svc = new AgentHumanRequestService(serverDB, userId, {
      notifier: { notify: async (item) => void notified.push(item) },
      now: () => now,
      sealer: await KeyVaultsGateKeeper.initWithEnvKey(),
      sender: unavailableSender,
    });
    const item = await svc.requestApproval(origin, action);

    const decided = await svc.decide(item.id, { action: 'approve' });

    expect(decided.status).toBe('failed');
    expect(decided.result?.error).toMatch(/No outbound channel/);
  });

  it('keeps a workspace card out of the personal scope and other workspaces', async () => {
    await serverDB.insert(workspaces).values([
      { id: 'ws-a', name: 'A', primaryOwnerId: userId, slug: 'ws-a' },
      { id: 'ws-b', name: 'B', primaryOwnerId: userId, slug: 'ws-b' },
    ]);
    const item = await (await service(userId, 'ws-a')).requestApproval(origin, action);

    const personal = await service();
    const otherWorkspace = await service(userId, 'ws-b');
    await expect(personal.get(item.id)).rejects.toThrow(/not found/i);
    await expect(otherWorkspace.decide(item.id, { action: 'approve' })).rejects.toThrow(
      /not found/i,
    );
    expect(await otherWorkspace.list({})).toEqual([]);
    expect((await (await service(userId, 'ws-a')).get(item.id)).id).toBe(item.id);
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

describe('outcome delivery to the agent', () => {
  it('redelivers an outcome whose wake failed, once, on a later owner read', async () => {
    const svc = await service();
    const item = await svc.requestApproval(origin, action);

    failWakes = 1;
    const decided = await svc.decide(item.id, { action: 'approve' });

    // The action result stands; only the wake is owed.
    expect(decided.status).toBe('completed');
    expect(notified).toHaveLength(0);
    let row = await rowOf(item.id);
    expect(row).toMatchObject({ notifiedAt: null, notifyAttempts: 1 });

    // A read right away leaves a possibly in-flight wake alone.
    await svc.list({});
    expect(notified).toHaveLength(0);

    // Once the attempt is stale, the next read delivers it.
    now += NOTIFY_REDELIVER_AFTER_MS + 1;
    await svc.list({});
    expect(notified.map((n) => [n.id, n.status])).toEqual([[item.id, 'completed']]);
    row = await rowOf(item.id);
    expect(row.notifiedAt).not.toBeNull();
    expect(row.notifyAttempts).toBe(2);

    // A delivered outcome is never sent again.
    now += NOTIFY_REDELIVER_AFTER_MS + 1;
    await svc.get(item.id);
    expect(notified).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('keeps a completed decision successful when claiming the wake fails', async () => {
    const svc = await service();
    const item = await svc.requestApproval(origin, action);
    const model = (svc as unknown as { model: { claimNotification: unknown } }).model;
    const claim = model.claimNotification;
    model.claimNotification = async () => {
      throw new Error('connection terminated unexpectedly');
    };

    const decided = await svc.decide(item.id, { action: 'approve' });

    // The message went out and the answer says so; the wake is simply owed.
    expect(decided.status).toBe('completed');
    expect(sent).toHaveLength(1);
    expect((await rowOf(item.id)).notifiedAt).toBeNull();

    // A failing redelivery does not break the owner's read either…
    expect(await svc.list({})).toHaveLength(1);

    // …and once the database is back, the outcome is delivered.
    model.claimNotification = claim;
    await svc.list({});
    expect(notified.map((n) => n.id)).toEqual([item.id]);
  });

  it('stops waking after the attempt cap', async () => {
    const svc = await service();
    const item = await svc.requestApproval(origin, action);

    failWakes = 100;
    await svc.decide(item.id, { action: 'decline' });
    for (let i = 0; i < 8; i++) {
      now += NOTIFY_REDELIVER_AFTER_MS + 1;
      await svc.list({});
    }

    expect((await rowOf(item.id)).notifyAttempts).toBe(5);
    expect(notified).toHaveLength(0);
  });

  it('does not let a stale wake acknowledge the newer outcome of a retry', async () => {
    let releaseFirstWake!: () => void;
    const wakes: string[] = [];
    let call = 0;
    const svc = new AgentHumanRequestService(serverDB, userId, {
      notifier: {
        notify: async (item) => {
          call += 1;
          if (call === 1) {
            // The wake for the failed send is still starting a run...
            await new Promise<void>((resolve) => (releaseFirstWake = resolve));
            wakes.push(item.status);
            return;
          }
          if (call === 2) throw new Error('could not start the agent run');
          wakes.push(item.status);
        },
      },
      now: () => now,
      sealer: await KeyVaultsGateKeeper.initWithEnvKey(),
      sender: async (accountId, message) => {
        sent.push({ accountId, message });
        return sendImpl(message);
      },
    });
    const item = await svc.requestApproval(origin, action);

    sendImpl = async () => {
      throw new Error('provider unavailable');
    };
    const firstDecision = svc.decide(item.id, { action: 'approve' });
    await vi.waitFor(() => expect(call).toBe(1));

    // ...when the owner retries; the send succeeds but its own wake fails.
    sendImpl = async () => ({ providerMessageId: 'pm-retry' });
    await svc.decide(item.id, { action: 'retry' });

    // The stale wake now returns. It must not mark the retry's outcome delivered.
    releaseFirstWake();
    await firstDecision;
    let row = await rowOf(item.id);
    expect(row.status).toBe('completed');
    expect(row.notifiedAt).toBeNull();

    // So the completed outcome is still redelivered.
    now += NOTIFY_REDELIVER_AFTER_MS + 1;
    await svc.list({});
    expect(wakes).toEqual(['failed', 'completed']);
    row = await rowOf(item.id);
    expect(row.notifiedAt).not.toBeNull();
  });

  it('delivers a retried outcome even after the failure was delivered', async () => {
    const svc = await service();
    const item = await svc.requestApproval(origin, action);

    sendImpl = async () => {
      throw new Error('provider unavailable');
    };
    await svc.decide(item.id, { action: 'approve' });
    sendImpl = async () => ({ providerMessageId: 'pm-retry' });
    await svc.decide(item.id, { action: 'retry' });

    expect(notified.map((n) => n.status)).toEqual(['failed', 'completed']);
    expect((await rowOf(item.id)).notifiedAt).not.toBeNull();
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

  it("refuses to send a secret to the agent's own address", async () => {
    const svc = await service();
    await expect(
      svc.requestSecret(origin, { ...secretAction, kind: 'otp', to: ' Aria@Lobe.ID ' }),
    ).rejects.toThrow(/own address/);
  });

  it('records a failure instead of staying stuck when the sealed key cannot be read', async () => {
    const sealer = await KeyVaultsGateKeeper.initWithEnvKey();
    const svc = new AgentHumanRequestService(serverDB, userId, {
      notifier: { notify: async (item) => void notified.push(item) },
      now: () => now,
      sealer: {
        decrypt: async () => {
          throw new Error('key vault unavailable');
        },
        encrypt: (data) => sealer.encrypt(data),
      },
      sender: async (accountId, message) => {
        sent.push({ accountId, message });
        return sendImpl(message);
      },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const item = await svc.requestSecret(origin, { ...secretAction, kind: 'otp' });

    const decided = await svc.decide(item.id, {
      action: 'fulfill',
      envelope: await sealFor(item),
    });

    expect(decided.status).toBe('failed');
    expect(decided.result?.error).toBe('Secure input could not be processed.');
    expect((await rowOf(item.id)).recipientKey).toBeNull();
    expect(sent).toHaveLength(0);
    errorSpy.mockRestore();
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

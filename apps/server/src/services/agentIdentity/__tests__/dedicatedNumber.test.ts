// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentNumberChargeModel, AgentPhoneNumberModel } from '@/database/models/agentPhoneNumber';
import {
  agentAccounts,
  agentNumberCharges,
  agentPhoneNumbers,
  agents,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import type { AgentInboundWakeInput } from '../inbound';
import { AgentInboundService } from '../inbound';
import { AgentAccountService } from '../index';
import { createDedicatedNumberAccountProvider } from '../numbers/accountProvider';
import { createTwilioSandbox } from '../numbers/sandbox/twilioSandbox';
import type { DedicatedNumberSettings } from '../numbers/service';
import { DedicatedNumberService, QUARANTINE_AUTO_REPLY } from '../numbers/service';
import { createTwilioNumberProvider } from '../numbers/twilio';
import { AgentAccountProviderRegistry } from '../registry';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'dedicated-number-user';
const agentId = 'dedicated-number-agent';
const otherAgentId = 'dedicated-number-agent-2';

const ACCOUNT_SID = 'AC00000000000000000000000000000001';
const AUTH_TOKEN = 'sandbox_auth_token';
const SERVICE_SID = 'MG00000000000000000000000000000001';
const WEBHOOK = 'https://app.example.com/api/agent/accounts/webhooks/twilio';

const gateKeeper = {
  decrypt: vi.fn(async (ciphertext: string) => ({ plaintext: ciphertext })),
  encrypt: vi.fn(async (plaintext: string) => plaintext),
};

const settings = (overrides: Partial<DedicatedNumberSettings> = {}): DedicatedNumberSettings => ({
  country: 'US',
  limits: { dailyOutboundSegments: 200, monthlySpendUsd: 20 },
  poolAreaCodes: ['415'],
  poolSize: 2,
  pricing: { carrierFeeUsd: 0.003, monthlyFeeUsd: 1.15, smsSegmentUsd: 0.0083 },
  quarantineDays: 45,
  smsWebhookUrl: WEBHOOK,
  ...overrides,
});

const setup = (options: { now?: () => Date; settings?: Partial<DedicatedNumberSettings> } = {}) => {
  const sandbox = createTwilioSandbox({
    accountSid: ACCOUNT_SID,
    authToken: AUTH_TOKEN,
    inventory: { '212': ['+12125550301'], '415': ['+14155550101', '+14155550102', '+14155550103'] },
    messagingServiceSid: SERVICE_SID,
  });
  const carrier = createTwilioNumberProvider({
    accountSid: ACCOUNT_SID,
    apiBaseUrl: 'https://api.twilio.test',
    authToken: AUTH_TOKEN,
    fetch: sandbox.fetch,
    messagingApiBaseUrl: 'https://messaging.twilio.test',
    messagingServiceSid: SERVICE_SID,
    smsWebhookUrl: WEBHOOK,
  });
  const numbers = new DedicatedNumberService(serverDB, carrier, settings(options.settings), {
    now: options.now,
  });
  const registry = new AgentAccountProviderRegistry().register(
    createDedicatedNumberAccountProvider(numbers),
  );
  const accounts = new AgentAccountService(serverDB, userId, { gateKeeper, registry });
  const waker = {
    wake: vi.fn(async (_input: AgentInboundWakeInput) => ({
      reason: 'started',
      started: true,
      topicId: 'tpc_1',
    })),
  };
  const inbound = new AgentInboundService(serverDB, { accountService: accounts, waker });

  return { accounts, inbound, numbers, sandbox, waker };
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(agents).values([
    { id: agentId, userId },
    { id: otherAgentId, userId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(agentNumberCharges);
  await serverDB.delete(agentPhoneNumbers);
  await serverDB.delete(agentAccounts);
  await serverDB.delete(users);
  vi.clearAllMocks();
});

describe('dedicated number — warm pool and allocation', () => {
  it('tops the pool up per area code, then hands a pooled number out retagged with its agent', async () => {
    const { accounts, numbers, sandbox } = setup();

    const report = await numbers.replenishPool();
    expect(report).toEqual([
      { areaCode: '415', bought: ['+14155550101', '+14155550102'], pooledBefore: 0 },
    ]);
    // Idempotent: a full pool buys nothing more.
    expect((await numbers.replenishPool())[0].bought).toEqual([]);

    const account = await accounts.provision({ agentId, prefix: '415', provider: 'twilio' });

    expect(account).toMatchObject({
      // Receive at once; send stays closed until the 10DLC campaign is approved.
      capabilities: { receive: true, send: false },
      identifier: '+14155550101',
      kind: 'phone',
      metadata: {
        allocatedFrom: 'pool',
        campaignStatus: 'pending',
        sendBlockedReason: 'messaging_campaign_not_approved',
      },
      provider: 'twilio',
      status: 'active',
    });

    const carrierSide = [...sandbox.state.numbers.values()].find(
      (n) => n.phoneNumber === '+14155550101',
    );
    expect(carrierSide?.friendlyName).toBe(`agent:${agentId}`);
    expect(carrierSide?.smsUrl).toBe(WEBHOOK);

    const inventory = await new AgentPhoneNumberModel(serverDB).findLiveByNumber(
      'twilio',
      '+14155550101',
    );
    expect(inventory).toMatchObject({ accountId: account.id, agentId, status: 'assigned' });

    // The first month's number fee is billed to the agent on allocation.
    const charges = await new AgentNumberChargeModel(serverDB).listForAgent(agentId);
    expect(charges.map((c) => [c.type, Number(c.amountUsd)])).toEqual([['number_monthly', 1.15]]);
  });

  it('buys instantly when the pool for the requested area code is dry', async () => {
    const { accounts } = setup();

    const account = await accounts.provision({ agentId, prefix: '212', provider: 'twilio' });
    expect(account).toMatchObject({
      identifier: '+12125550301',
      metadata: { allocatedFrom: 'instant' },
    });
  });

  it('refuses a malformed area code instead of silently ignoring it', async () => {
    const { accounts } = setup();
    await expect(
      accounts.provision({ agentId, prefix: 'abc', provider: 'twilio' }),
    ).rejects.toThrow(/not a 3-digit area code/);
  });
});

describe('dedicated number — graded capability and billing', () => {
  it('blocks outbound until the carrier reports an approved campaign, then bills each send', async () => {
    const { accounts, numbers, sandbox } = setup();
    const account = await accounts.provision({ agentId, provider: 'twilio' });

    await expect(
      accounts.send(account.id, { text: 'hi', to: '+15551230000' }),
    ).rejects.toMatchObject({ code: 'send_not_enabled' });
    expect(sandbox.state.messages).toHaveLength(0);

    sandbox.state.campaignStatus = 'VERIFIED';
    expect(await numbers.refreshAllEligibility()).toEqual({ approved: 1, checked: 1 });

    const refreshed = await accounts.get(account.id);
    expect(refreshed?.capabilities).toEqual({ receive: true, send: true });
    expect(refreshed?.metadata).not.toHaveProperty('sendBlockedReason');

    await accounts.send(account.id, { text: 'hello from your agent', to: '+15551230000' });
    expect(sandbox.state.messages).toMatchObject([
      { body: 'hello from your agent', from: account.identifier, to: '+15551230000' },
    ]);

    const charges = await new AgentNumberChargeModel(serverDB).listForAgent(agentId);
    expect(charges.map((c) => c.type).sort()).toEqual([
      'carrier_fee',
      'number_monthly',
      'sms_segment',
    ]);
  });

  it('stops sending at the per-agent daily volume cap', async () => {
    const { accounts, numbers, sandbox } = setup({
      settings: { limits: { dailyOutboundSegments: 1, monthlySpendUsd: 20 } },
    });
    const account = await accounts.provision({ agentId, provider: 'twilio' });
    sandbox.state.campaignStatus = 'VERIFIED';
    await numbers.refreshAllEligibility();

    await accounts.send(account.id, { text: 'one', to: '+15551230000' });
    await expect(
      accounts.send(account.id, { text: 'two', to: '+15551230000' }),
    ).rejects.toMatchObject({ code: 'spend_limit_reached' });
    expect(sandbox.state.messages).toHaveLength(1);
  });

  it('stops sending at the per-agent monthly USD cap', async () => {
    const { accounts, numbers, sandbox } = setup({
      // The 1.15 monthly fee already uses the whole cap.
      settings: { limits: { dailyOutboundSegments: 200, monthlySpendUsd: 1.15 } },
    });
    const account = await accounts.provision({ agentId, provider: 'twilio' });
    sandbox.state.campaignStatus = 'VERIFIED';
    await numbers.refreshAllEligibility();

    await expect(
      accounts.send(account.id, { text: 'hi', to: '+15551230000' }),
    ).rejects.toMatchObject({ code: 'spend_limit_reached' });
  });
});

describe('dedicated number — inbound, quarantine and release', () => {
  it('delivers a signed inbound SMS, wakes the agent, and bills the inbound segment', async () => {
    const { accounts, inbound, sandbox, waker } = setup();
    const account = await accounts.provision({ agentId, provider: 'twilio' });

    const delivery = sandbox.buildInbound({
      body: 'Your code is 482913',
      from: '+15557654321',
      to: account.identifier,
    });
    const result = await inbound.handle('twilio', {
      body: delivery.body,
      headers: delivery.headers,
    });

    expect(result).toMatchObject({ created: true, outcome: 'delivered', status: 200 });
    expect(waker.wake).toHaveBeenCalledTimes(1);
    expect(waker.wake.mock.calls[0][0]).toMatchObject({
      message: { codes: ['482913'], from: '+15557654321', threadKey: '+15557654321' },
    });

    // A replay is absorbed: same message, no second wake, no second charge.
    const replay = await inbound.handle('twilio', {
      body: delivery.body,
      headers: delivery.headers,
    });
    expect(replay).toMatchObject({ created: false, outcome: 'delivered' });
    expect(waker.wake).toHaveBeenCalledTimes(1);

    const inboundCharges = (
      await new AgentNumberChargeModel(serverDB).listForAgent(agentId)
    ).filter((c) => c.type === 'sms_segment');
    expect(inboundCharges).toHaveLength(1);
  });

  it('takes a voicemail on a live number and delivers its transcript like a text (no 10DLC needed)', async () => {
    const { accounts, inbound, numbers, sandbox, waker } = setup();
    const account = await accounts.provision({ agentId, provider: 'twilio' });
    // Pending campaign: outbound is closed, voice still answers.
    expect(account.capabilities.send).toBe(false);

    const call = sandbox.buildCall({ from: '+15557654321', to: account.identifier });
    const answer = await numbers.answerVoiceCall({ body: call.body, headers: call.headers });
    expect(answer).toMatchObject({ mode: 'voicemail', status: 200 });
    expect(answer?.body).toContain(`transcribeCallback="${WEBHOOK}"`);

    const transcript = sandbox.buildTranscription({
      callSid: call.callSid,
      callbackUrl: WEBHOOK,
      from: '+15557654321',
      text: 'Your verification code is 9 1 4 2 7 7',
      to: account.identifier,
    });
    const result = await inbound.handle('twilio', {
      body: transcript.body,
      headers: transcript.headers,
    });
    expect(result).toMatchObject({ created: true, outcome: 'delivered' });
    expect(waker.wake.mock.calls[0][0]).toMatchObject({
      // Read-out digits are joined so the code is extracted like a texted one.
      message: {
        codes: ['914277'],
        from: '+15557654321',
        text: 'Voicemail: Your verification code is 914277',
      },
    });

    // A voicemail is not an SMS: no per-segment charge.
    const charges = await new AgentNumberChargeModel(serverDB).listForAgent(agentId);
    expect(charges.map((c) => c.type)).toEqual(['number_monthly']);
  });

  it('rejects a forged voice webhook', async () => {
    const { accounts, numbers, sandbox } = setup();
    const account = await accounts.provision({ agentId, provider: 'twilio' });
    const call = sandbox.buildCall({ from: '+15557654321', to: account.identifier });

    expect(
      await numbers.answerVoiceCall({
        body: call.body,
        headers: { ...call.headers, 'x-twilio-signature': 'forged' },
      }),
    ).toMatchObject({ mode: 'rejected', status: 401 });
  });

  it('rejects a forged signature', async () => {
    const { accounts, inbound, sandbox } = setup();
    const account = await accounts.provision({ agentId, provider: 'twilio' });
    const delivery = sandbox.buildInbound({
      body: 'hi',
      from: '+15557654321',
      to: account.identifier,
    });

    const result = await inbound.handle('twilio', {
      body: delivery.body,
      headers: { ...delivery.headers, 'x-twilio-signature': 'forged' },
    });
    expect(result).toMatchObject({ outcome: 'rejected', status: 401 });
  });

  it('quarantines on release, answers "out of service" without waking anyone, and only then releases', async () => {
    let now = new Date('2026-10-05T00:00:00.000Z');
    const { accounts, inbound, numbers, sandbox, waker } = setup({ now: () => now });
    sandbox.state.campaignStatus = 'VERIFIED';
    const account = await accounts.provision({ agentId, provider: 'twilio' });
    const phone = account.identifier;

    await accounts.revoke(account.id);

    const inventory = new AgentPhoneNumberModel(serverDB);
    const quarantined = await inventory.findLiveByNumber('twilio', phone);
    expect(quarantined).toMatchObject({ agentId, status: 'quarantined' });
    expect(quarantined?.quarantineUntil?.toISOString()).toBe('2026-11-19T00:00:00.000Z');
    // Still held at the carrier, retagged as quarantine.
    const carrierSide = [...sandbox.state.numbers.values()].find((n) => n.phoneNumber === phone);
    expect(carrierSide).toMatchObject({ friendlyName: 'quarantine:2026-11-19', released: false });

    // Someone texts the old number (e.g. a site sending the previous owner's OTP).
    const delivery = sandbox.buildInbound({ body: 'code 111222', from: '+15550009999', to: phone });
    const result = await inbound.handle('twilio', {
      body: delivery.body,
      headers: delivery.headers,
    });
    expect(result).toEqual({ detail: 'auto-replied', outcome: 'quarantined', status: 200 });
    expect(waker.wake).not.toHaveBeenCalled();
    expect(sandbox.state.messages).toMatchObject([
      { body: QUARANTINE_AUTO_REPLY, from: phone, to: '+15550009999' },
    ]);

    // Once per sender per day.
    const again = sandbox.buildInbound({ body: 'code 333444', from: '+15550009999', to: phone });
    expect(await inbound.handle('twilio', { body: again.body, headers: again.headers })).toEqual({
      detail: 'already-replied-today',
      outcome: 'quarantined',
      status: 200,
    });

    // A call to the old number hears it is out of service and leaves nothing.
    const call = sandbox.buildCall({ from: '+15550009999', to: phone });
    const answer = await numbers.answerVoiceCall({ body: call.body, headers: call.headers });
    expect(answer).toMatchObject({ mode: 'out-of-service', status: 200 });
    expect(answer?.body).toContain('This number is no longer in service.');
    expect(answer?.body).not.toContain('<Record');

    // Not assignable during quarantine: another agent gets a different number.
    const other = await new AgentAccountService(serverDB, userId, {
      gateKeeper,
      registry: new AgentAccountProviderRegistry().register(
        createDedicatedNumberAccountProvider(numbers),
      ),
    }).provision({ agentId: otherAgentId, provider: 'twilio' });
    expect(other.identifier).not.toBe(phone);

    // Before the quarantine ends nothing is released…
    expect(await numbers.releaseExpired()).toEqual({ failed: [], released: [] });
    // …after it ends the carrier DELETE runs and the row is terminal.
    now = new Date('2026-11-19T00:00:01.000Z');
    expect(await numbers.releaseExpired()).toEqual({ failed: [], released: [phone] });
    expect(carrierSide?.released).toBe(true);
    expect(sandbox.state.log).toContainEqual({
      method: 'DELETE',
      path: `/2010-04-01/Accounts/${ACCOUNT_SID}/IncomingPhoneNumbers/${carrierSide?.sid}.json`,
      status: 204,
    });
    expect(await inventory.findLiveByNumber('twilio', phone)).toBeUndefined();
  });

  it('does not auto-reply from a quarantined number that may not send', async () => {
    const { accounts, inbound, sandbox } = setup();
    const account = await accounts.provision({ agentId, provider: 'twilio' });
    await accounts.revoke(account.id);

    const delivery = sandbox.buildInbound({
      body: 'hi',
      from: '+15550009999',
      to: account.identifier,
    });
    expect(
      await inbound.handle('twilio', { body: delivery.body, headers: delivery.headers }),
    ).toEqual({
      detail: 'messaging-not-approved',
      outcome: 'quarantined',
      status: 200,
    });
    expect(sandbox.state.messages).toHaveLength(0);
  });

  it('returns a claimed number to the pool when the account row cannot be written', async () => {
    const { accounts } = setup();

    // Corrupt the inventory so the pool offers a number a live account still
    // routes on: the account write then fails on the phone routing index after
    // the claim, and the claim must be undone rather than leak an assignment.
    const first = await accounts.provision({ agentId, provider: 'twilio' });
    await serverDB.update(agentPhoneNumbers).set({ agentId: null, status: 'pooled' });
    await expect(
      accounts.provision({ agentId: otherAgentId, provider: 'twilio' }),
    ).rejects.toMatchObject({
      code: 'identifier_taken',
    });

    const inventory = await new AgentPhoneNumberModel(serverDB).findLiveByNumber(
      'twilio',
      first.identifier,
    );
    expect(inventory?.status).toBe('pooled');
  });
});

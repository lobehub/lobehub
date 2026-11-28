// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { ChannelReplyErrorFacts } from '@/database/repositories/channel';

import { classifyReplyFailure, ruleBasedReplyError } from './rules';

const NOW = new Date('2026-11-20T00:00:00.000Z');

const facts = (
  operation: Partial<NonNullable<ChannelReplyErrorFacts['operation']>> | null,
  overrides: Partial<ChannelReplyErrorFacts> = {},
  job: Partial<ChannelReplyErrorFacts['job']> = {},
): ChannelReplyErrorFacts => ({
  agent: { id: 'agt', name: 'Coder' },
  deviceId: 'device-1',
  job: {
    acceptedAt: new Date(),
    blockedCode: null,
    id: 'job',
    messageId: 'msg',
    operationId: 'op',
    status: 'failed',
    threadId: null,
    topicId: 'tpc',
    ...job,
  },
  operation: operation && {
    error: null,
    interruption: null,
    startedAt: new Date(),
    status: 'error',
    topicId: 'tpc',
    userId: 'user',
    workspaceId: null,
    ...operation,
  },
  request: 'Why did the deploy fail?',
  requesterUserId: 'user',
  ...overrides,
});

describe('reply error cards for a requester who may not use the Agent', () => {
  // A visitor DMing a link-shared Claude Code Agent without its device grant got "the reply could
  // not start" and a Retry that could never succeed.
  it('asks the owner for access when a shared local CLI Agent refuses the visitor', () => {
    const refused = facts(
      {
        error: {
          message: 'This shared Agent cannot run for visitors in its current setup',
          type: 'ShareHeterogeneousAgentUnsupported',
        },
      },
      { share: { showErrorDetails: false } },
      { acceptedAt: null },
    );
    expect(classifyReplyFailure(refused)).toBe('access_required');
    expect(ruleBasedReplyError(refused, 'zh-CN', NOW)).toMatchObject({
      actions: ['request_access'],
      kind: 'access_required',
      summary: 'Coder 需要主人授权后才能使用。申请后，主人同意即可继续。',
    });
    expect(ruleBasedReplyError(refused, 'en-US', NOW).summary).toBe(
      "Coder needs its owner's permission before you can use it. Ask for access; it continues once they allow it.",
    );
  });

  it('says the owner declined, with asking again as the only step', () => {
    const declined = facts(
      null,
      {},
      { acceptedAt: null, blockedCode: 'access_denied', operationId: null, topicId: null },
    );
    expect(classifyReplyFailure(declined)).toBe('access_denied');
    expect(ruleBasedReplyError(declined, 'zh-CN', NOW)).toMatchObject({
      actions: ['request_access'],
      deviceId: null,
      errorMessage: null,
      errorType: null,
      kind: 'access_denied',
      summary: 'Coder 的主人拒绝了你的使用申请，这次没有回复。可以再次申请。',
    });
  });
});

describe('rule-based reply error cards', () => {
  it('explains an abandoned run and recommends resuming it', () => {
    const card = ruleBasedReplyError(
      facts({
        error: { message: 'Operation abandoned: inactivity_watchdog' },
        status: 'abandoned',
      }),
      'zh-CN',
      NOW,
    );
    expect(card).toEqual({
      actions: ['resume', 'retry'],
      deviceId: null,
      errorMessage: 'Operation abandoned: inactivity_watchdog',
      errorType: null,
      kind: 'watchdog',
      occurredAt: NOW.toISOString(),
      summary: 'Coder 长时间没有进展，这次回复被系统中止了。',
    });
  });

  it('points at the device when it could not be reached', () => {
    const card = ruleBasedReplyError(
      facts(
        {
          error: { message: 'The device is offline', type: 'DeviceGatewayNotConfigured' },
        },
        {},
        { acceptedAt: null },
      ),
      'en-US',
      NOW,
    );
    expect(card).toMatchObject({
      actions: ['retry', 'switch_device'],
      deviceId: 'device-1',
      errorType: 'DeviceGatewayNotConfigured',
      kind: 'device',
      summary: "Coder's device could not be reached, so the reply did not start.",
    });
  });

  it('tells a spent plan window from exhausted credits', () => {
    expect(
      ruleBasedReplyError(
        facts({ error: { message: "You've hit your weekly limit · resets Jul 3 at 1pm" } }),
        'en-US',
      ),
    ).toMatchObject({ actions: ['resume', 'switch_device'], kind: 'quota_usage' });
    expect(
      ruleBasedReplyError(
        facts({ error: { message: "You've reached your usage limit. Run /usage-credits" } }),
        'en-US',
      ),
    ).toMatchObject({ actions: ['switch_device', 'retry'], kind: 'quota_credit' });
  });

  it('recognises the device watchdog silence timeout', () => {
    expect(
      ruleBasedReplyError(
        facts({
          error: { message: 'No output for 20 minutes', type: 'HeteroAgentSilenceTimeout' },
        }),
        'zh-CN',
      ),
    ).toMatchObject({
      actions: ['resume', 'retry'],
      deviceId: 'device-1',
      kind: 'silence',
      summary: 'Coder 在设备上长时间没有任何输出，这次回复被中止了。',
    });
  });

  // A Claude Code run on a device whose proxy dropped the connection read as a vague "the reply was
  // cut off by a connection problem", with nothing saying the network or proxy was the cause.
  it('names the network and proxy when a device run lost its connection', () => {
    const dropped = facts({
      error: {
        message:
          'API Error: Connection dropped (ECONNRESET). Check the proxy set in https_proxy, then try again.',
        type: 'AgentRuntimeError',
      },
    });
    expect(classifyReplyFailure(dropped)).toBe('network');
    expect(ruleBasedReplyError(dropped, 'zh-CN', NOW)).toMatchObject({
      actions: ['resume', 'retry', 'switch_device'],
      deviceId: 'device-1',
      errorType: 'AgentRuntimeError',
      kind: 'network',
      summary:
        'Coder 所在设备的网络连接断开了，回复没能完成。请检查这台设备的网络和代理设置后重试。',
    });
    expect(ruleBasedReplyError(dropped, 'en-US', NOW).summary).toBe(
      "Coder's device lost its network connection, so the reply could not finish. Check that device's network and proxy settings, then try again.",
    );
  });

  it('recognises how runtimes word a lost connection', () => {
    for (const message of [
      'API Error: Connection error.',
      'socket hang up',
      'TypeError: fetch failed',
      'connect ECONNREFUSED 127.0.0.1:7890',
      'getaddrinfo ENOTFOUND api.anthropic.com',
      'stream disconnected before completion: error sending request',
    ])
      expect(classifyReplyFailure(facts({ error: { message } }))).toBe('network');
    // A 429 or a provider's own error is not the network.
    expect(classifyReplyFailure(facts({ error: { message: 'Rate limited (429)' } }))).toBe(
      'generic',
    );
  });

  it('leaves the proxy out of a cloud run, which the person cannot configure', () => {
    const card = ruleBasedReplyError(
      facts({ error: { message: 'read ECONNRESET' } }, { deviceId: null }),
      'zh-CN',
      NOW,
    );
    expect(card).toMatchObject({
      actions: ['resume', 'retry'],
      deviceId: null,
      kind: 'network',
      summary: 'Coder 的网络连接断开了，回复没能完成。可以稍后重试。',
    });
  });

  it('keeps a run that never started as could-not-start, even on a network error', () => {
    expect(
      classifyReplyFailure(facts({ error: { message: 'fetch failed' } }, {}, { acceptedAt: null })),
    ).toBe('dispatch');
  });

  it('only offers a fresh start for a run that never took its input', () => {
    expect(
      ruleBasedReplyError(
        facts(
          { error: { message: 'Agent could not start' }, status: 'error' },
          {},
          {
            acceptedAt: null,
          },
        ),
        'en-US',
      ),
    ).toMatchObject({ actions: ['retry'], kind: 'dispatch' });
  });

  it('falls back to a generic explanation, and to an empty reply when the run finished', () => {
    expect(
      classifyReplyFailure(facts({ error: { message: 'Cannot read properties of undefined' } })),
    ).toBe('generic');
    expect(classifyReplyFailure(facts({ status: 'done' }))).toBe('no_reply');
    expect(ruleBasedReplyError(facts({ status: 'done' }), 'en-US').summary).toBe(
      'Coder finished running without writing a reply.',
    );
  });

  it("keeps a shared Agent's owner details and device out of the visitor's card", () => {
    const card = ruleBasedReplyError(
      facts(
        { error: { message: 'Owner key sk-123 was rejected', type: 'InvalidProviderAPIKey' } },
        { share: { showErrorDetails: false } },
      ),
      'en-US',
    );
    expect(card.errorMessage ?? '').not.toContain('sk-123');
    expect(card.actions).not.toContain('switch_device');
  });

  it("explains a shared Agent's monthly usage limit without offering a doomed retry", () => {
    const card = ruleBasedReplyError(
      facts(
        {
          error: {
            message: 'This shared Agent reached its monthly usage limit',
            type: 'ShareSpendLimitExceeded',
          },
        },
        { share: { showErrorDetails: false } },
        { acceptedAt: null },
      ),
      'zh-CN',
      NOW,
    );
    expect(card.kind).toBe('share_spend_limit');
    expect(card.actions).toEqual([]);
    expect(card.summary).toBe(
      'Coder 已用完这个分享的用量额度，这次没有回复。需要创建者提高额度才能继续。',
    );
    expect(card.errorType).toBe('ShareSpendLimitExceeded');
  });

  it("points a shared Agent's visitor to a tip once its visitor funds ran out", () => {
    const card = ruleBasedReplyError(
      facts(
        {
          error: {
            message: 'This shared Agent has run out of funds for visitor replies',
            type: 'ShareFundingExhausted',
          },
        },
        { share: { showErrorDetails: false } },
        { acceptedAt: null },
      ),
      'zh-CN',
      NOW,
    );
    expect(card.kind).toBe('share_funding');
    expect(card.actions).toEqual([]);
    expect(card.summary).toBe('Coder 的访客额度已用完，这次没有回复。打赏后即可继续使用。');
    expect(card.errorType).toBe('ShareFundingExhausted');
  });

  it("explains a shared Agent's message limit without offering a doomed resume", () => {
    const card = ruleBasedReplyError(
      facts(
        { error: { message: 'limit', type: 'ShareMessageLimitExceeded' } },
        { share: { showErrorDetails: false } },
      ),
      'en-US',
      NOW,
    );
    expect(card.kind).toBe('share_message_limit');
    expect(card.actions).toEqual([]);
    expect(card.summary).toBe(
      'Messages to Coder reached the limit its creator set, so it did not reply. Its creator needs to raise the limit.',
    );
  });

  it("never persists a shared Agent's owner detail, even with the share's details enabled", () => {
    const card = ruleBasedReplyError(
      facts(
        { error: { message: 'Owner key sk-123 was rejected', type: 'InvalidProviderAPIKey' } },
        { share: { showErrorDetails: true } },
      ),
      'en-US',
    );
    expect(card.errorMessage ?? '').not.toContain('sk-123');
    expect(card.actions).not.toContain('switch_device');
  });
});

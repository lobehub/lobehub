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
    expect(classifyReplyFailure(facts({ error: { message: 'socket hang up' } }))).toBe('generic');
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

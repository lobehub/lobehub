import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexApprovalBridge } from './CodexApprovalBridge';

/** Records the actual gateway envelope, retaining the native request payload. */
const setup = () => {
  const events: AgentStreamEvent[] = [];
  const bridge = new CodexApprovalBridge({
    emit: (event) => {
      events.push(event);
    },
    operationId: 'op',
    timeoutMs: 1000,
  });
  const request = (toolCallId = 'item', availableDecisions = ['accept', 'cancel']) =>
    bridge.request({
      apiName: 'command_execution',
      arguments: {
        availableDecisions,
        command: 'touch outside',
        reason: 'Write outside workspace',
      },
      interventionId: 'native-id',
      toolCallId,
    });
  const latestId = () => {
    const event = events.findLast((item) => item.type === 'agent_intervention_request');
    if (!event || typeof event.data.interventionId !== 'string')
      throw new Error('Missing callback');
    return event.data.interventionId;
  };
  return { bridge, events, latestId, request };
};
afterEach(() => {
  vi.useRealTimers();
});

/** @example Every displayed request keeps its own context and one-shot callback. */
describe('CodexApprovalBridge', () => {
  // ROOT CAUSE:
  // Native callbacks can share one item id; publishing both replaces the only
  // intervention on its tool message. Unique ids plus a per-tool queue preserve
  // both requests and prevent a delayed click from approving the next callback.
  /** @example Two native callbacks for one item are actionable in order. */
  it('serializes requests and rejects a repeated decision for the previous callback', async () => {
    const { bridge, events, latestId, request } = setup();
    const first = request();
    const firstId = latestId();
    const second = request();
    /** @example Only the active callback reaches the message projection. */
    expect(events.filter((e) => e.type === 'agent_intervention_request')).toHaveLength(1);
    /** @example The active callback accepts its advertised choice. */
    expect(bridge.resolve(firstId, 'accept')).toBe(true);
    /** @example The first native promise receives exactly its decision. */
    await expect(first).resolves.toBe('accept');
    const secondId = latestId();
    /** @example A reused native item id still gets a new callback. */
    expect(secondId).not.toBe(firstId);
    /** @example A delayed UI response cannot consume the next callback. */
    expect(bridge.resolve(firstId, 'accept')).toBe(false);
    bridge.resolve(secondId, 'cancel');
    /** @example Cancellation resolves only the second native promise. */
    await expect(second).resolves.toBe('cancel');
  });

  /** @example Advertised restrictions and the native reason survive transport. */
  it('keeps approval details and rejects an unadvertised decision', async () => {
    const { bridge, events, latestId, request } = setup();
    const pending = request('item', ['cancel']);
    const payload = events[0].data;
    /** @example The renderer receives the exact restricted choice set. */
    expect(JSON.parse(String(payload.arguments))).toMatchObject({
      availableDecisions: ['cancel'],
      reason: 'Write outside workspace',
    });
    /** @example Generic accept cannot bypass the native decision set. */
    expect(bridge.resolve(latestId(), 'accept')).toBe(false);
    bridge.resolve(latestId(), 'cancel');
    /** @example A rejected invalid choice leaves the callback cancellable. */
    await expect(pending).resolves.toBe('cancel');
  });

  // ROOT CAUSE:
  // Native network proposals serialize host before action, while the renderer
  // constructs action before host. JSON string comparison rejects equivalent
  // authorization. Compare permission fields while still rejecting other hosts.
  /** @example Native and renderer property order describe the same permission. */
  it.each([false, true])(
    'matches network permission fields with advertised choices: %s',
    async (advertised) => {
      const { bridge, latestId } = setup();
      const nativePolicy = { host: 'example.com', action: 'allow' };
      const decision = {
        applyNetworkPolicyAmendment: {
          network_policy_amendment: { action: 'allow' as const, host: 'example.com' },
        },
      };
      const pending = bridge.request({
        apiName: 'command_execution',
        arguments: {
          ...(advertised
            ? {
                availableDecisions: [
                  { applyNetworkPolicyAmendment: { network_policy_amendment: nativePolicy } },
                  'cancel',
                ],
              }
            : {}),
          networkApprovalContext: { host: 'example.com', protocol: 'https' },
          proposedNetworkPolicyAmendments: [nativePolicy],
        },
        interventionId: 'native-network',
        toolCallId: 'network-command',
      });
      try {
        /** @example A different destination cannot reuse the native proposal. */
        expect(
          bridge.resolve(latestId(), {
            applyNetworkPolicyAmendment: {
              network_policy_amendment: { action: 'allow', host: 'other.example' },
            },
          }),
        ).toBe(false);
        /** @example Key ordering cannot invalidate an equivalent native choice. */
        expect(bridge.resolve(latestId(), decision)).toBe(true);
        /** @example The native request receives the authorized destination only. */
        await expect(pending).resolves.toEqual(decision);
      } finally {
        bridge.cancelAll();
      }
    },
  );

  /** @example A timeout retires its own card before publishing the next one. */
  it('times out the active request without timing out an undisplayed request', async () => {
    vi.useFakeTimers();
    const { events, request, bridge, latestId } = setup();
    const first = request();
    const oldId = latestId();
    const second = request();
    await vi.advanceTimersByTimeAsync(1000);
    /** @example The first request fails closed. */
    await expect(first).resolves.toBe('cancel');
    /** @example Publication order keeps the old timeout away from the new card. */
    expect(events.map((e) => e.type)).toEqual([
      'agent_intervention_request',
      'agent_intervention_response',
      'agent_intervention_request',
    ]);
    /** @example Timeout callback ids cannot be submitted later. */
    expect(bridge.resolve(oldId, 'accept')).toBe(false);
    bridge.resolve(latestId(), 'accept');
    /** @example The queued request has its own full interaction lifetime. */
    await expect(second).resolves.toBe('accept');
  });

  /** @example Closing a turn cancels both displayed and queued requests. */
  it('cancels all requests on close and accepts no later request', async () => {
    const { bridge, request } = setup();
    const first = request();
    const second = request();
    bridge.cancelAll();
    /** @example Both native requests terminate without permission. */
    await expect(Promise.all([first, second])).resolves.toEqual(['cancel', 'cancel']);
    /** @example A closed operation cannot open a new approval prompt. */
    await expect(request()).resolves.toBe('cancel');
  });
});

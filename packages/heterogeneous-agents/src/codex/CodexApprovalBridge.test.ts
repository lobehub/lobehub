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
        cwd: '/workspace',
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
  // Desktop updates its card through IPC, but device cards remain resolving
  // until the producer acknowledges the exact intervention and resolution.
  /** @example A remote allow emits its producer receipt exactly once. */
  it('acknowledges the consumed native decision with its remote resolution id', async () => {
    const { bridge, events, latestId, request } = setup();
    const pending = request();
    const id = latestId();
    bridge.resolve(id, 'accept', { resolutionRequestId: 'resolution-one' });
    await pending;
    /** @example The receipt settles only the UI callback that native Codex consumed. */
    expect(events.filter((event) => event.type === 'agent_intervention_response')).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          interventionId: id,
          producerAck: true,
          resolutionRequestId: 'resolution-one',
          result: { decision: 'accept' },
          toolCallId: 'item',
        }),
      }),
    ]);
    bridge.resolve(id, 'accept', { resolutionRequestId: 'resolution-one' });
    /** @example A replay cannot acknowledge or approve another callback. */
    expect(events.filter((event) => event.type === 'agent_intervention_response')).toHaveLength(1);
  });

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

  it('declines only the timed-out action when Codex offers decline', async () => {
    vi.useFakeTimers();
    const { request } = setup();
    const pending = request('item', ['accept', 'decline', 'cancel']);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toBe('decline');
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
  /** @example Review preserves working directory and exact file scope without modifying native arguments. */
  it('includes complete native scope in the durable Review', async () => {
    const { bridge, events } = setup();
    const args = { cwd: '/task', grantRoot: '/task/allowed', reason: 'Edit one file' };
    const toolContext = {
      changes: [{ path: '/task/allowed/a.txt', diffText: '+approved content', kind: 'add' }],
    };
    const pending = bridge.request({
      apiName: 'file_change',
      arguments: args,
      interventionId: 'native',
      toolCallId: 'file-item',
      toolContext,
    });
    const event = events.find((entry) => entry.type === 'agent_intervention_request')!;
    const review = JSON.parse(String(event.data.reviewArguments));
    /** @example Both the diff and session grant root remain reviewable. */
    expect(review.questions[0].question).toContain('+approved content');
    /** @example The working directory is not silently omitted. */
    expect(review.questions[0].question).toContain('/task');
    /** @example A session grant states its exact scope. */
    expect(
      review.questions[0].options.find((option: { id: string }) => option.id === 'decision_1')
        .description,
    ).toContain('/task/allowed');
    /** @example Context does not rewrite Codex's original RPC payload. */
    expect(JSON.parse(String(event.data.arguments))).toEqual(args);
    bridge.cancelAll();
    await pending;
  });

  // ROOT CAUSE:
  // The canonical sanitizer rejects oversized option descriptions. The producer
  // previously emitted such options, breaking ingestion while Codex stayed parked.
  // Keep original indices and remove only unreviewable grants, never truncate scope.
  /** @example An oversized amendment still has an actionable exact Deny/Stop path. */
  it('filters oversized grants while preserving native option indices', async () => {
    const { bridge, events } = setup();
    const pending = bridge.request({
      apiName: 'command_execution',
      arguments: {
        command: 'echo hello',
        cwd: '/task',
        reason: 'Test',
        availableDecisions: [
          'accept',
          { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['x'.repeat(1100)] } },
          'decline',
          'cancel',
        ],
      },
      interventionId: 'native',
      toolCallId: 'command',
    });
    const event = events.find((entry) => entry.type === 'agent_intervention_request')!;
    const review = JSON.parse(String(event.data.reviewArguments));
    /** @example Removing decision_1 never relabels decision_2 as an allow grant. */
    expect(review.questions[0].options.map((option: { id: string }) => option.id)).toEqual([
      'decision_0',
      'decision_2',
      'decision_3',
    ]);
    /** @example The command's directory and reason are displayed with its text. */
    expect(review.questions[0].question).toContain('/task');
    bridge.cancelAll();
    await pending;
  });

  /** @example A command beyond the renderer limit cannot authorize an unseen suffix. */
  it('fails closed on an unrepresentable approval scope', async () => {
    const { bridge, events } = setup();
    const pending = bridge.request({
      apiName: 'command_execution',
      arguments: { command: 'x'.repeat(4001), availableDecisions: ['accept', 'cancel'] },
      interventionId: 'native',
      toolCallId: 'command',
    });
    const event = events.find((entry) => entry.type === 'agent_intervention_request')!;
    const review = JSON.parse(String(event.data.reviewArguments));
    /** @example No allow action remains after context exceeds the display bound. */
    expect(review.questions[0].options.map((option: { id: string }) => option.id)).toEqual([
      'decision_1',
    ]);
    /** @example A direct stale client cannot bypass the same producer restriction. */
    expect(bridge.resolve(String(event.data.interventionId), 'accept')).toBe(false);
    bridge.cancelAll();
    await pending;
  });

  // ROOT CAUSE:
  // The size check accepted an empty native scope. No command/cwd or real diff
  // was required, so an invisible operation could still be authorized.
  /** @example Missing scope leaves only the bridge's explicit Stop option. */
  it.each([
    { apiName: 'command_execution' as const, arguments: {}, toolContext: undefined },
    {
      apiName: 'command_execution' as const,
      arguments: { command: 'touch unknown' },
      toolContext: undefined,
    },
    { apiName: 'file_change' as const, arguments: {}, toolContext: { changes: [] } },
    {
      apiName: 'file_change' as const,
      arguments: {},
      toolContext: { changes: [{ path: '/unknown' }] },
    },
  ])('rejects grants when native scope is missing: $apiName $arguments', async (request) => {
    const { bridge, events, latestId } = setup();
    const pending = bridge.request({
      ...request,
      arguments: { ...request.arguments, availableDecisions: ['accept'] },
      interventionId: 'native-missing',
      toolCallId: 'missing-scope',
    });
    const review = JSON.parse(String(events[0].data.reviewArguments));
    /** @example A grant with unknown scope is never displayed or accepted. */
    expect(review.questions[0].options).toEqual([{ id: 'cancel_turn', label: 'Stop this turn' }]);
    /** @example A stale or alternate client cannot bypass the producer check. */
    expect(bridge.resolve(latestId(), 'accept')).toBe(false);
    bridge.cancelAll();
    await pending;
  });
});

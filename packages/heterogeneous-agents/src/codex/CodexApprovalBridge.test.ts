import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CodexApprovalDecision } from './CodexApprovalBridge';
import { CodexApprovalBridge, isCodexApprovalDecision } from './CodexApprovalBridge';

const createBridge = (timeoutMs = 1000) => {
  const events: AgentStreamEvent[] = [];
  const bridge = new CodexApprovalBridge({
    emit: (event) => {
      events.push(event);
    },
    operationId: 'operation-1',
    timeoutMs,
  });
  const request = (interventionId = 'approval-1', toolCallId = 'item-1') =>
    bridge.request({
      apiName: 'command_execution',
      arguments: { command: 'git status' },
      interventionId,
      toolCallId,
    });

  return { bridge, events, request };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('CodexApprovalBridge', () => {
  it.each<CodexApprovalDecision>([
    'accept',
    'acceptForSession',
    'decline',
    'cancel',
    {
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: ['/usr/bin/curl', '-I', 'https://github.com'],
      },
    },
    {
      applyNetworkPolicyAmendment: {
        network_policy_amendment: { action: 'allow', host: 'github.com' },
      },
    },
  ])('returns the %s decision to Codex', async (decision) => {
    const { bridge, events, request } = createBridge();
    const pending = request();

    expect(events).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          apiName: 'command_execution',
          identifier: 'codex',
          interventionId: 'approval-1',
          toolCallId: 'item-1',
        }),
        operationId: 'operation-1',
        type: 'agent_intervention_request',
      }),
    );
    expect(bridge.resolve('approval-1', decision)).toBe(true);
    await expect(pending).resolves.toEqual(decision);
  });

  it('validates structured decisions received over IPC', () => {
    expect(
      isCodexApprovalDecision({
        acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'status'] },
      }),
    ).toBe(true);
    expect(
      isCodexApprovalDecision({
        applyNetworkPolicyAmendment: {
          network_policy_amendment: { action: 'deny', host: 'example.com' },
        },
      }),
    ).toBe(true);
    expect(
      isCodexApprovalDecision({
        acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 42] },
      }),
    ).toBe(false);
  });

  it('queues repeated approvals for the same tool item', async () => {
    const { bridge, request } = createBridge();
    const first = request('item-1', 'item-1');
    const second = request('item-1', 'item-1');

    expect(bridge.resolve('item-1', 'accept')).toBe(true);
    await expect(first).resolves.toBe('accept');
    expect(bridge.resolve('item-1', 'decline')).toBe(true);
    await expect(second).resolves.toBe('decline');
    expect(bridge.resolve('item-1', 'accept')).toBe(false);
  });

  it('cancels and closes an approval when it times out', async () => {
    vi.useFakeTimers();
    const { events, request } = createBridge(50);
    const pending = request();

    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toBe('cancel');
    expect(events).toContainEqual(
      expect.objectContaining({
        data: {
          cancelReason: 'timeout',
          cancelled: true,
          interventionId: 'approval-1',
          toolCallId: 'item-1',
        },
        type: 'agent_intervention_response',
      }),
    );
  });

  it('cancels every pending approval when the turn closes', async () => {
    const { bridge, events, request } = createBridge();
    const first = request('approval-1', 'item-1');
    const second = request('approval-2', 'item-2');

    bridge.cancelAll();

    await expect(first).resolves.toBe('cancel');
    await expect(second).resolves.toBe('cancel');
    expect(
      events.filter(
        (event) =>
          event.type === 'agent_intervention_response' &&
          event.data.cancelReason === 'session_ended',
      ),
    ).toHaveLength(2);
    await expect(request('approval-3', 'item-3')).resolves.toBe('cancel');
  });
});

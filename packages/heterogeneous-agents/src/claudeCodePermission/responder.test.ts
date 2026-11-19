import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { AskUserBridge } from '../askUser/AskUserBridge';
import { ClaudeCodeLiveInput } from '../spawn/claudeCodeLiveInput';
import { PermissionModeReporter } from './modeReport';
import {
  askThroughBridge,
  attachClaudeCodePermissionResponder,
  buildSetPermissionModeRequest,
} from './responder';

const line = (value: unknown) => `${JSON.stringify(value)}\n`;

const setup = () => {
  const stdin = new PassThrough();
  const written: any[] = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const text of chunk.toString().split('\n'))
      if (text.trim()) written.push(JSON.parse(text));
  });
  const live = new ClaudeCodeLiveInput(stdin, { idleCloseMs: 60_000 });
  const bridge = new AskUserBridge('op-1');
  const requests: any[] = [];
  void (async () => {
    for await (const event of bridge.events()) requests.push(event);
  })();
  attachClaudeCodePermissionResponder(live, {
    ask: askThroughBridge(bridge),
    cancel: (id) => bridge.cancel(id, 'session_ended'),
  });
  return { bridge, live, requests, written };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const canUseTool = {
  request: {
    input: { command: 'rm -rf build' },
    permission_suggestions: [],
    subtype: 'can_use_tool',
    tool_name: 'Bash',
    tool_use_id: 'toolu_bash',
  },
  request_id: 'req-7',
  type: 'control_request',
};

describe('attachClaudeCodePermissionResponder', () => {
  it('raises a card that never times out and writes the answer to stdin', async () => {
    const { bridge, live, requests, written } = setup();
    live.observe(line(canUseTool));
    await flush();

    expect(requests).toHaveLength(1);
    expect(requests[0].type).toBe('agent_intervention_request');
    expect(requests[0].data).toMatchObject({
      interactionKind: 'permission',
      provider: 'claude-code',
      toolCallId: 'cc-permission-req-7',
    });
    // The wire deadline is a year out: nothing on the producer side expires it.
    expect(requests[0].data.deadline - Date.now()).toBeGreaterThan(300 * 24 * 3600 * 1000);

    bridge.resolve('cc-permission-req-7', { result: { q: 'allow' } });
    await flush();

    expect(written.at(-1)).toEqual({
      response: {
        request_id: 'req-7',
        response: {
          behavior: 'allow',
          toolUseID: 'toolu_bash',
          updatedInput: { command: 'rm -rf build' },
        },
        subtype: 'success',
      },
      type: 'control_response',
    });
  });

  it('withdraws the card when Claude Code cancels the request', async () => {
    const { live, requests, written } = setup();
    live.observe(line(canUseTool));
    await flush();
    live.observe(line({ request_id: 'req-7', type: 'control_cancel_request' }));
    await flush();

    expect(requests.at(-1)).toMatchObject({
      data: { cancelled: true, toolCallId: 'cc-permission-req-7' },
      type: 'agent_intervention_response',
    });
    expect(written.at(-1).response.response).toMatchObject({ behavior: 'deny', interrupt: true });
  });

  it('answers no request once input closed', async () => {
    const { bridge, live, written } = setup();
    live.observe(line(canUseTool));
    await flush();
    live.close();
    bridge.resolve('cc-permission-req-7', { result: { q: 'allow' } });
    await flush();
    expect(written).toEqual([]);
  });
});

describe('buildSetPermissionModeRequest', () => {
  it('switches mode, turning bypass into acceptEdits as root, and keeps the pick for the host', () => {
    expect(buildSetPermissionModeRequest('plan', false)).toEqual({
      __host: { requestedMode: 'plan' },
      mode: 'plan',
      subtype: 'set_permission_mode',
    });
    expect(buildSetPermissionModeRequest('bypassPermissions', true)).toEqual({
      __host: { requestedMode: 'bypassPermissions' },
      mode: 'acceptEdits',
      subtype: 'set_permission_mode',
    });
  });

  it('never sends the host metadata to Claude Code, and hands it to listeners', () => {
    const { live, written } = setup();
    const sent: any[] = [];
    live.onControlRequestSent((request, meta) => sent.push({ meta, request }));
    live.sendControlRequest(buildSetPermissionModeRequest('bypassPermissions', true));
    expect(written[0].request).toEqual({ mode: 'acceptEdits', subtype: 'set_permission_mode' });
    expect(sent).toEqual([
      {
        meta: { requestedMode: 'bypassPermissions' },
        request: { mode: 'acceptEdits', subtype: 'set_permission_mode' },
      },
    ]);
  });
});

describe('PermissionModeReporter', () => {
  it('reports init and status modes once per change', () => {
    const reporter = new PermissionModeReporter('op-1', undefined);
    const init = reporter.observe({ permissionMode: 'plan', subtype: 'init', type: 'system' });
    expect(init).toMatchObject({
      data: { fallback: null, permissionMode: 'plan', phase: 'permission_mode' },
      operationId: 'op-1',
      type: 'step_complete',
    });
    expect(
      reporter.observe({ permissionMode: 'plan', subtype: 'init', type: 'system' }),
    ).toBeUndefined();
    // Approving the plan: Claude Code switches itself and says so.
    expect(
      reporter.observe({
        permissionMode: 'acceptEdits',
        status: null,
        subtype: 'status',
        type: 'system',
      })?.data.permissionMode,
    ).toBe('acceptEdits');
  });

  it('ignores sub-agents and modes it does not offer', () => {
    const reporter = new PermissionModeReporter('op-1', undefined);
    expect(
      reporter.observe({
        parent_tool_use_id: 'toolu_task',
        permissionMode: 'plan',
        subtype: 'init',
        type: 'system',
      }),
    ).toBeUndefined();
    expect(
      reporter.observe({ permissionMode: 'dontAsk', subtype: 'init', type: 'system' }),
    ).toBeUndefined();
  });

  it('keeps a bypass pick made mid-run as root instead of taking acceptEdits', () => {
    // Started in default on a root device; the user switches to Allow everything.
    const reporter = new PermissionModeReporter('op-1', undefined);
    reporter.observe({ permissionMode: 'default', subtype: 'init', type: 'system' });
    reporter.requested('bypassPermissions', true);
    expect(
      reporter.observe({ permissionMode: 'acceptEdits', subtype: 'status', type: 'system' })?.data,
    ).toEqual({ fallback: 'root', permissionMode: 'acceptEdits', phase: 'permission_mode' });
    // Re-reported even when the mode did not change, so the fallback reaches the topic.
    reporter.requested('bypassPermissions', true);
    expect(
      reporter.observe({ permissionMode: 'acceptEdits', subtype: 'status', type: 'system' })?.data
        .fallback,
    ).toBe('root');
  });

  it('explains the root fallback while it applies', () => {
    const reporter = new PermissionModeReporter('op-1', 'root');
    expect(
      reporter.observe({ permissionMode: 'acceptEdits', subtype: 'init', type: 'system' })?.data
        .fallback,
    ).toBe('root');
    expect(
      reporter.observe({ permissionMode: 'plan', subtype: 'status', type: 'system' })?.data
        .fallback,
    ).toBeNull();
    // Approving that plan with accepted edits is the user's own pick, not the fallback.
    expect(
      reporter.observe({ permissionMode: 'acceptEdits', subtype: 'status', type: 'system' })?.data
        .fallback,
    ).toBeNull();
  });
});

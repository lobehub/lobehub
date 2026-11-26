import { PassThrough } from 'node:stream';

import { AskUserBridge } from '@lobechat/heterogeneous-agents/askUser';
import { ClaudeCodeLiveInput } from '@lobechat/heterogeneous-agents/spawn';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  attachCliPermissionPrompts,
  setSessionPermissionMode,
} from '../heterogeneousAgentPermission';

const createLive = () => {
  const stdin = new PassThrough();
  const written: any[] = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const raw of chunk.toString().split('\n')) if (raw) written.push(JSON.parse(raw));
  });
  return { live: new ClaudeCodeLiveInput(stdin), written };
};

const line = (value: unknown) => `${JSON.stringify(value)}\n`;

describe('attachCliPermissionPrompts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers a local CLI prompt from its card and emits the reported mode', async () => {
    vi.spyOn(process, 'getuid').mockReturnValue(501);
    const { live, written } = createLive();
    const bridge = new AskUserBridge('op-local');
    const requests: any[] = [];
    void (async () => {
      for await (const event of bridge.events()) requests.push(event);
    })();
    const emitted: any[] = [];
    attachCliPermissionPrompts({
      bridge,
      emit: (event) => emitted.push(event),
      live,
      operationId: 'op-local',
      permissionMode: 'default',
    });

    live.observe(line({ permissionMode: 'default', subtype: 'init', type: 'system' }));
    live.observe(
      line({
        request: {
          input: { command: 'npm test' },
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          tool_use_id: 'toolu_b',
        },
        request_id: 'req-b',
        type: 'control_request',
      }),
    );
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    bridge.resolve('cc-permission-req-b', { result: { q: 'deny', __note: 'run lint instead' } });
    await vi.waitFor(() => expect(written).toHaveLength(1));

    expect(emitted[0].data).toEqual({
      fallback: null,
      permissionMode: 'default',
      phase: 'permission_mode',
    });
    expect(written[0].response.response).toEqual({
      behavior: 'deny',
      message: 'The user denied this: run lint instead',
      toolUseID: 'toolu_b',
    });
  });
});

describe('setSessionPermissionMode', () => {
  it('uses the SDK query when the run has one', async () => {
    const setPermissionMode = vi.fn();
    await setSessionPermissionMode({ sdkSession: { setPermissionMode } as any }, 'plan');
    expect(setPermissionMode).toHaveBeenCalledWith('plan');
  });

  it('writes set_permission_mode into a live CLI and waits for Claude Code', async () => {
    const { live, written } = createLive();
    const switching = setSessionPermissionMode({ liveInput: live }, 'acceptEdits');
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0].request).toEqual({ mode: 'acceptEdits', subtype: 'set_permission_mode' });
    live.observe(
      line({
        response: {
          request_id: written[0].request_id,
          response: { mode: 'acceptEdits' },
          subtype: 'success',
        },
        type: 'control_response',
      }),
    );
    await expect(switching).resolves.toBe('acceptEdits');
  });

  it('refuses a run that has ended', async () => {
    await expect(setSessionPermissionMode(undefined, 'plan')).rejects.toThrow(
      'cannot switch its permission mode',
    );
  });
});

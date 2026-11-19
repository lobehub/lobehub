import type * as ChildProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import type * as Os from 'node:os';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AskUserBridge } from '../askUser/AskUserBridge';

const spawnCalls: Array<{ args: string[] }> = [];
let nextProc: any;

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof ChildProcess>('node:child_process');
  return {
    ...actual,
    spawn: vi.fn((_command: string, args: string[]) => {
      spawnCalls.push({ args });
      return nextProc;
    }),
  };
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof Os>('node:os');
  return { ...actual, platform: vi.fn(() => 'linux') };
});

/** A Claude Code child whose stdin stays readable, as a live session's does. */
const createLiveProc = () => {
  const proc = new EventEmitter() as any;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.kill = vi.fn();
  proc.killed = false;
  proc.pid = 4242;
  const stdinLines: any[] = [];
  proc.stdin.on('data', (chunk: Buffer) => {
    for (const text of chunk.toString().split('\n'))
      if (text.trim()) stdinLines.push(JSON.parse(text));
  });
  const emit = (record: unknown) => proc.stdout.write(`${JSON.stringify(record)}\n`);
  const finish = () => {
    proc.stdout.end();
    proc.stderr.end();
    proc.emit('exit', 0, null);
  };
  return { emit, finish, proc, stdinLines };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('spawnAgent — Claude Code permission modes', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
    vi.spyOn(process, 'getuid').mockReturnValue(501);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks over stdio, answers through the bridge and reports the mode', async () => {
    const live = createLiveProc();
    nextProc = live.proc;
    const bridge = new AskUserBridge('op-perm');
    const bridgeEvents: any[] = [];
    void (async () => {
      for await (const event of bridge.events()) bridgeEvents.push(event);
    })();

    const { spawnAgent } = await import('./spawnAgent');
    const handle = await spawnAgent({
      agentType: 'claude-code',
      askUserBridge: bridge,
      liveInput: true,
      operationId: 'op-perm',
      permissionMode: 'plan',
      prompt: 'plan it',
    });

    const { args } = spawnCalls[0];
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
    expect(args[args.indexOf('--permission-prompt-tool') + 1]).toBe('stdio');
    expect(args).toContain('--allow-dangerously-skip-permissions');

    const events: any[] = [];
    const consumed = (async () => {
      for await (const event of handle.events) events.push(event);
    })();

    live.emit({ permissionMode: 'plan', session_id: 's1', subtype: 'init', type: 'system' });
    live.emit({
      request: {
        input: { plan: '# Plan' },
        subtype: 'can_use_tool',
        tool_name: 'ExitPlanMode',
        tool_use_id: 'toolu_plan',
      },
      request_id: 'req-plan',
      type: 'control_request',
    });
    await flush();

    expect(bridgeEvents[0]).toMatchObject({
      data: { interactionKind: 'plan', toolCallId: 'cc-permission-req-plan' },
      type: 'agent_intervention_request',
    });
    bridge.resolve('cc-permission-req-plan', { result: { q: 'approve_accept_edits' } });
    await flush();

    expect(live.stdinLines.at(-1)).toEqual({
      response: {
        request_id: 'req-plan',
        response: {
          behavior: 'allow',
          toolUseID: 'toolu_plan',
          updatedInput: { plan: '# Plan' },
          updatedPermissions: [{ destination: 'session', mode: 'acceptEdits', type: 'setMode' }],
        },
        subtype: 'success',
      },
      type: 'control_response',
    });

    live.emit({ permissionMode: 'acceptEdits', status: null, subtype: 'status', type: 'system' });
    await flush();
    live.finish();
    await consumed;

    expect(
      events
        .filter((event) => event.data?.phase === 'permission_mode')
        .map((event) => event.data.permissionMode),
    ).toEqual(['plan', 'acceptEdits']);
  });

  it('fails closed, never bypassing, when no bridge can answer a picked mode', async () => {
    const live = createLiveProc();
    nextProc = live.proc;
    const { spawnAgent } = await import('./spawnAgent');
    await spawnAgent({
      agentType: 'claude-code',
      liveInput: true,
      operationId: 'op-nobridge',
      permissionMode: 'plan',
      prompt: 'hi',
    });
    const { args } = spawnCalls.at(-1)!;
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
    expect(args).not.toContain('--permission-prompt-tool');
    expect(args).not.toContain('--allow-dangerously-skip-permissions');
    live.finish();
  });

  it('allows everything, as before, without a mode', async () => {
    for (const options of [{ askUserBridge: new AskUserBridge('op-a') }]) {
      const live = createLiveProc();
      nextProc = live.proc;
      const { spawnAgent } = await import('./spawnAgent');
      await spawnAgent({
        agentType: 'claude-code',
        liveInput: true,
        operationId: 'op-a',
        prompt: 'hi',
        ...options,
      });
      const { args } = spawnCalls.at(-1)!;
      expect(args[args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions');
      expect(args).not.toContain('--permission-prompt-tool');
      live.finish();
    }
  });

  it('runs bypass as plain acceptEdits as root, and says why', async () => {
    vi.spyOn(process, 'getuid').mockReturnValue(0);
    const live = createLiveProc();
    nextProc = live.proc;
    const { spawnAgent } = await import('./spawnAgent');
    const handle = await spawnAgent({
      agentType: 'claude-code',
      askUserBridge: new AskUserBridge('op-root'),
      liveInput: true,
      operationId: 'op-root',
      permissionMode: 'bypassPermissions',
      prompt: 'hi',
    });

    const { args } = spawnCalls[0];
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
    // Nothing pre-approved: a rule would outlive a switch to a stricter mode.
    expect(args).not.toContain('--allowed-tools');
    expect(args).not.toContain('--allow-dangerously-skip-permissions');

    const events: any[] = [];
    const consumed = (async () => {
      for await (const event of handle.events) events.push(event);
    })();
    live.emit({ permissionMode: 'acceptEdits', session_id: 's', subtype: 'init', type: 'system' });
    await flush();
    live.finish();
    await consumed;
    expect(events.find((event) => event.data?.phase === 'permission_mode')?.data).toEqual({
      fallback: 'root',
      permissionMode: 'acceptEdits',
      phase: 'permission_mode',
    });
  });
});

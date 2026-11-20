import { existsSync, readFileSync } from 'node:fs';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCodexAgentHandle } from './codexAgentHandle';
import type { CodexThreadSessionOptions, CodexThreadTurnOptions } from './CodexThreadSession';

const mocks = vi.hoisted(() => ({
  clientClose: vi.fn(),
  clientOptions: vi.fn(),
  interrupt: vi.fn(),
  options: [] as CodexThreadSessionOptions[],
  run: vi.fn<
    (options: CodexThreadTurnOptions, session: CodexThreadSessionOptions) => Promise<void>
  >(),
  sessionClose: vi.fn(),
  steer: vi.fn(),
}));
vi.mock('./CodexAppServerClient', () => ({
  CodexAppServerClient: class {
    constructor(options: object) {
      mocks.clientOptions(options);
    }
    close = mocks.clientClose;
    onStderr() {
      return () => {};
    }
  },
}));
vi.mock('./CodexThreadSession', () => ({
  CodexThreadSession: class {
    constructor(private readonly options: CodexThreadSessionOptions) {
      mocks.options.push(options);
    }
    close = mocks.sessionClose;
    interrupt = mocks.interrupt;
    steer = mocks.steer;
    run(options: CodexThreadTurnOptions) {
      return mocks.run(options, this.options);
    }
  },
}));

/** @example Native device turns use the same thread state machine as Desktop, with the normal CLI event handle. */
describe('createCodexAgentHandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.options.length = 0;
    mocks.run.mockResolvedValue();
  });
  const options = {
    args: [],
    clientVersion: '0.0.61',
    commandPath: 'codex',
    cwd: process.cwd(),
    env: { LOBEHUB_AGENT_ID: 'agent-device', LOBEHUB_TOPIC_ID: 'topic-device' },
    operationId: 'op-device',
    prompt: 'one prompt',
  };

  /** @example Native session and turn provenance reach the ingest loop unchanged. */
  it('resumes the native session and exposes its turn provenance', async () => {
    const event: AgentStreamEvent = {
      data: { sessionId: 'native-session', codexTurnId: 'native-turn' },
      operationId: 'op-device',
      stepIndex: 0,
      timestamp: 1,
      type: 'stream_start',
    };
    mocks.run.mockImplementation(async (_turn, session) => {
      session.onSessionId('native-session');
      await session.onEvents([event]);
    });
    const handle = await createCodexAgentHandle({ ...options, resumeSessionId: 'native-session' });
    // ROOT CAUSE:
    // The client appends app-server itself; passing that subcommand here launched it twice.
    /** @example The transport exclusively owns its app-server subcommand. */
    expect(mocks.clientOptions).toHaveBeenCalledWith(expect.objectContaining({ args: undefined }));
    /** @example Shell identity is pinned per operation and remains compatible with shared app-server provenance. */
    expect(mocks.options[0].threadParams.config).toMatchObject({
      'shell_environment_policy.set.LOBEHUB_AGENT_ID': 'agent-device',
      'shell_environment_policy.set.LOBEHUB_OPERATION_ID': 'op-device',
      'shell_environment_policy.set.LOBEHUB_TOPIC_ID': 'topic-device',
    });
    const events: AgentStreamEvent[] = [];
    for await (const event of handle.events) events.push(event);
    /** @example The saved native session is resumed rather than replayed as text. */
    expect(mocks.options[0]).toMatchObject({ initialThreadId: 'native-session' });
    /** @example The session reported by the native thread is exposed on finish. */
    expect(handle.sessionId).toBe('native-session');
    /** @example The normal stream retains codexTurnId for message provenance. */
    expect(events).toEqual([event]);
    /** @example Successful native completion closes the per-operation process. */
    expect(await handle.exit).toEqual({ code: 0, signal: null });
    /** @example A completed device operation leaves no app-server process alive. */
    expect(mocks.clientClose).toHaveBeenCalledOnce();
  });

  /** @example An ordinary topic surfaces the raw Codex error so the CLI can retry fresh. */
  /** @example `inherit = "core"` cannot strip the scope and credentials `lh` needs. */
  it('forwards workspace, server and a JWT file through the shell policy', async () => {
    const handle = await createCodexAgentHandle({
      ...options,
      env: {
        ...options.env,
        LOBEHUB_JWT: 'secret-jwt',
        LOBEHUB_SERVER: 'https://app.lobehub.com',
        LOBEHUB_WORKSPACE_ID: 'ws-airi',
      },
    });
    const config = mocks.options[0].threadParams.config ?? {};
    expect(config).toMatchObject({
      'shell_environment_policy.set.LOBEHUB_SERVER': 'https://app.lobehub.com',
      'shell_environment_policy.set.LOBEHUB_WORKSPACE_ID': 'ws-airi',
    });
    // The token itself never enters the persisted thread config, only its 0600 file.
    expect(JSON.stringify(config)).not.toContain('secret-jwt');
    const jwtPath = config['shell_environment_policy.set.LOBEHUB_JWT_FILE'] as string;
    expect(readFileSync(jwtPath, 'utf8')).toBe('secret-jwt');

    await handle.exit;
    await vi.waitFor(() => expect(existsSync(jwtPath)).toBe(false));
  });

  it('surfaces a missing ordinary session so the CLI can retry fresh', async () => {
    mocks.run.mockRejectedValue(
      new Error('thread/resume failed: no rollout found for thread id stale'),
    );
    const handle = await createCodexAgentHandle({ ...options, resumeSessionId: 'stale' });
    let stderr = '';
    handle.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    for await (const _event of handle.events) {
      /* Drain the actual async event contract. */
    }
    expect(await handle.exit).toEqual({ code: 1, signal: null });
    expect(stderr).toContain('no rollout found');
  });

  const interruptedEnd: AgentStreamEvent = {
    data: { reason: 'interrupted' },
    operationId: 'op-device',
    stepIndex: 0,
    timestamp: 1,
    type: 'agent_runtime_end',
  };

  // ROOT CAUSE:
  // A transport crash ends the native turn with an interrupted runtime end while run()
  // resolves, so the handle exited 0 and `lh hetero exec` finished a truncated run as success.
  /** @example A turn lost to transport failure exits as a failure, not a success. */
  it('fails a native turn interrupted by transport loss', async () => {
    mocks.run.mockImplementation(async (_turn, session) => {
      await session.onEvents([interruptedEnd]);
    });
    const handle = await createCodexAgentHandle(options);
    let stderr = '';
    handle.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    for await (const _event of handle.events) {
      /* Drain the actual async event contract. */
    }
    /** @example A nonzero exit makes the CLI report the operation as failed. */
    expect(await handle.exit).toEqual({ code: 1, signal: null });
    /** @example The failure detail explains the truncated turn. */
    expect(stderr).toContain('interrupted the turn');
  });

  /** @example A user Stop keeps its cancellation outcome even though the turn ends interrupted. */
  it('keeps a user Stop as cancellation', async () => {
    let releaseTurn!: () => void;
    const stopped = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    mocks.interrupt.mockImplementation(async () => releaseTurn());
    mocks.run.mockImplementation(async (_turn, session) => {
      await stopped;
      await session.onEvents([interruptedEnd]);
    });
    const handle = await createCodexAgentHandle(options);
    handle.kill('SIGINT');
    for await (const _event of handle.events) {
      /* Drain the actual async event contract. */
    }
    /** @example Stop is reported as a signal-driven cancellation, never as a failure. */
    expect(await handle.exit).toEqual({ code: null, signal: 'SIGINT' });
  });

  const runningStatus = {
    activeTasks: [],
    lastEventAt: 1,
    sessionId: 'op-device',
    state: 'running' as const,
    transport: 'codex-app-server' as const,
  };

  // ROOT CAUSE:
  // The native handle exposed no `sendUserMessage`, so `lh hetero exec` never polled the
  // steer queue and a follow-up sent mid-run waited for the whole Codex turn to finish.
  /** @example A follow-up joins the running native turn through `turn/steer`. */
  it('steers a follow-up into the running turn once it has started', async () => {
    let releaseTurn!: () => void;
    const turnDone = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    let started!: () => void;
    mocks.steer.mockResolvedValue('accepted');
    mocks.run.mockImplementation(async (_turn, session) => {
      await new Promise<void>((resolve) => {
        started = () => {
          session.onRuntimeStatus(runningStatus);
          resolve();
        };
      });
      await turnDone;
    });
    const handle = await createCodexAgentHandle(options);

    const sent = handle.sendUserMessage!('look at the tests too', { uuid: 'msg-steer' });
    await Promise.resolve();
    /** @example Before turn/start answers there is no turn to steer, so the write waits. */
    expect(mocks.steer).not.toHaveBeenCalled();

    started();
    expect(await sent).toBe(true);
    /** @example The delivery id comes back as the user message's client id for the confirmation. */
    expect(mocks.steer).toHaveBeenCalledWith(
      [{ text: 'look at the tests too', text_elements: [], type: 'text' }],
      'msg-steer',
    );

    releaseTurn();
    await handle.exit;
  });

  /** @example A turn that takes no input (review, compaction, already ending) leaves the message for the next run. */
  it('reports a refused steer as not delivered', async () => {
    mocks.steer.mockResolvedValue('rejected');
    mocks.run.mockImplementation(async (_turn, session) => {
      session.onRuntimeStatus(runningStatus);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const handle = await createCodexAgentHandle(options);

    expect(await handle.sendUserMessage!('one more thing', { uuid: 'msg-refused' })).toBe(false);
    await handle.exit;
  });

  /** @example A run that ended before its turn started takes nothing; the message waits for the next run. */
  it('does not steer once the run has ended', async () => {
    const handle = await createCodexAgentHandle(options);
    await handle.exit;

    expect(await handle.sendUserMessage!('too late', { uuid: 'msg-late' })).toBe(false);
    expect(mocks.steer).not.toHaveBeenCalled();
  });

  /** @example Unsupported approval policy is refused before executing any native request. */
  it('does not downgrade an unsupported native permission policy', async () => {
    /** @example The Full access-only base must reject Ask until its permission bridge is available. */
    await expect(
      createCodexAgentHandle({ ...options, args: ['--ask-for-approval', 'on-request'] }),
    ).rejects.toThrow('does not support');
    /** @example No session is created under weakened permissions. */
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

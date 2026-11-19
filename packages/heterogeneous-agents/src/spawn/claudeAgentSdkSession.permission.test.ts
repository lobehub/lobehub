import os from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AskUserBridge } from '../askUser/AskUserBridge';
import { ClaudeAgentSdkSession, type ClaudeAgentSdkSessionOptions } from './claudeAgentSdkSession';

const sdkQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: sdkQueryMock }));

const baseOptions = (
  overrides: Partial<ClaudeAgentSdkSessionOptions> = {},
): ClaudeAgentSdkSessionOptions => ({
  args: [],
  commandPath: 'claude',
  cwd: os.tmpdir(),
  env: {} as NodeJS.ProcessEnv,
  onEvents: () => {},
  onRawMessage: () => {},
  onRuntimeStatus: () => {},
  onSessionId: () => {},
  onStderr: () => {},
  operationId: 'op-sdk-perm',
  sessionId: 'session-1',
  stdinPayload: `${JSON.stringify({ message: { content: 'hi', role: 'user' }, type: 'user' })}\n`,
  ...overrides,
});

describe('ClaudeAgentSdkSession permission modes', () => {
  beforeEach(() => {
    vi.spyOn(process, 'getuid').mockReturnValue(501);
  });

  afterEach(() => {
    sdkQueryMock.mockReset();
    vi.restoreAllMocks();
  });

  const optionsFor = async (overrides: Partial<ClaudeAgentSdkSessionOptions>) => {
    sdkQueryMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {},
      close: vi.fn(),
    }));
    await new ClaudeAgentSdkSession(baseOptions(overrides)).run();
    return sdkQueryMock.mock.calls[0][0].options;
  };

  it('bypasses every prompt when the lab picked no mode', async () => {
    const options = await optionsFor({ askUserBridge: new AskUserBridge('op') });
    expect(options.permissionMode).toBe('bypassPermissions');
    expect(options.allowDangerouslySkipPermissions).toBe(true);
    expect(options.canUseTool).toBeUndefined();
  });

  it('starts in the picked mode and asks through canUseTool', async () => {
    const options = await optionsFor({
      askUserBridge: new AskUserBridge('op'),
      permissionMode: 'default',
    });
    expect(options.permissionMode).toBe('default');
    // Permits a later switch to bypass (the chip, a plan approval).
    expect(options.allowDangerouslySkipPermissions).toBe(true);
    expect(typeof options.canUseTool).toBe('function');
  });

  it('answers canUseTool from the card, with no inactivity timeout while it waits', async () => {
    const bridge = new AskUserBridge('op-sdk-perm');
    const requests: any[] = [];
    void (async () => {
      for await (const event of bridge.events()) requests.push(event);
    })();
    let decision: unknown;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    sdkQueryMock.mockImplementation(({ options }: any) => ({
      async *[Symbol.asyncIterator]() {
        yield { permissionMode: 'default', session_id: 's', subtype: 'init', type: 'system' };
        decision = await options.canUseTool(
          'Write',
          { content: 'hi', file_path: '/a.txt' },
          {
            requestId: 'req-sdk',
            signal: new AbortController().signal,
            suggestions: [{ destination: 'session', mode: 'acceptEdits', type: 'setMode' }],
            toolUseID: 'toolu_w',
          },
        );
        await held;
      },
      close: vi.fn(),
    }));

    process.env.LOBE_CLAUDE_CODE_SDK_INACTIVITY_TIMEOUT_MS = '20';
    const events: any[] = [];
    const session = new ClaudeAgentSdkSession(
      baseOptions({
        askUserBridge: bridge,
        onEvents: (batch) => {
          events.push(...batch);
        },
        permissionMode: 'default',
      }),
    );
    const running = session.run();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    // Longer than the inactivity timeout: the pending card holds the session.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(requests[0].data).toMatchObject({
      interactionKind: 'permission',
      toolCallId: 'cc-permission-req-sdk',
    });

    bridge.resolve('cc-permission-req-sdk', { result: { q: 'allow_session' } });
    await vi.waitFor(() => expect(decision).toBeDefined());
    release();
    await running;
    delete process.env.LOBE_CLAUDE_CODE_SDK_INACTIVITY_TIMEOUT_MS;

    expect(decision).toEqual({
      behavior: 'allow',
      updatedInput: { content: 'hi', file_path: '/a.txt' },
      updatedPermissions: [{ destination: 'session', mode: 'acceptEdits', type: 'setMode' }],
    });
    expect(events.find((event) => event.data?.phase === 'permission_mode')?.data).toMatchObject({
      permissionMode: 'default',
    });
  });

  it('switches mode mid-run through Query.setPermissionMode', async () => {
    const setPermissionMode = vi.fn();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    sdkQueryMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        await held;
        yield* [];
      },
      close: vi.fn(),
      setPermissionMode,
    }));
    const session = new ClaudeAgentSdkSession(
      baseOptions({ askUserBridge: new AskUserBridge('op'), permissionMode: 'plan' }),
    );
    const running = session.run();
    await vi.waitFor(() => expect(sdkQueryMock).toHaveBeenCalled());
    await session.setPermissionMode('acceptEdits');
    expect(setPermissionMode).toHaveBeenCalledWith('acceptEdits');
    release();
    await running;
    await expect(session.setPermissionMode('plan')).rejects.toThrow('no longer running');
  });
});

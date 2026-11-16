import { LocalSystemApiName } from '@lobechat/builtin-tool-local-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

const mockExecuteToolCall = vi.fn(async () => ({ content: 'ok', success: true }));
vi.mock('@/server/services/deviceGateway/authorizedToolCall', () => ({
  executeAuthorizedDeviceToolCall: (_serverDB: unknown, ...args: unknown[]) =>
    (mockExecuteToolCall as any)(...args),
}));

// The async-shell switch is a deployment flag; flip it through a mutable object.
const envMock = vi.hoisted(() => ({
  AGENT_ASYNC_SHELL: 'true' as string | undefined,
  AGENT_ASYNC_SHELL_PARK_WINDOW_MS: undefined as number | undefined,
  AGENT_ASYNC_SHELL_TIMEOUT_MS: 60_000 as number | undefined,
}));
vi.mock('@lobechat/env/agent', () => ({ agentEnv: envMock }));

const { localSystemRuntime } = await import('../localSystem');

const context = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
  activeDeviceId: 'device-1',
  operationId: 'op-1',
  toolCallId: 'call-1',
  toolManifestMap: {},
  userId: 'user-1',
  ...overrides,
});

const dispatchedParams = () => (mockExecuteToolCall.mock.calls[0] as unknown[])[0] as any;

describe('localSystemRuntime late-completion registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.AGENT_ASYNC_SHELL = 'true';
  });

  it('lets the device report a command result later', async () => {
    const proxy = localSystemRuntime.factory(context()) as Record<string, (a: any) => any>;

    await proxy[LocalSystemApiName.runCommand]({ command: 'sleep 600' });

    expect(dispatchedParams().completion).toEqual({
      callbackUrl: expect.stringMatching(/\/api\/agent\/device-tool-completion$/),
      toolCallId: 'call-1',
      // Outlives the server's own deadline, so the server — not the gateway —
      // decides when the wait is over.
      ttlMs: expect.any(Number),
    });
    expect(dispatchedParams().completion.ttlMs).toBeGreaterThan(60_000);
  });

  it('registers nothing for a call that cannot outlive itself', async () => {
    const proxy = localSystemRuntime.factory(context()) as Record<string, (a: any) => any>;

    await proxy[LocalSystemApiName.readFile]({ path: 'a.txt' });

    expect(dispatchedParams().completion).toBeUndefined();
  });

  it('registers nothing with async shell off', async () => {
    envMock.AGENT_ASYNC_SHELL = undefined;
    const proxy = localSystemRuntime.factory(context()) as Record<string, (a: any) => any>;

    await proxy[LocalSystemApiName.runCommand]({ command: 'sleep 600' });

    expect(dispatchedParams().completion).toBeUndefined();
  });

  it('registers nothing without a tool call id to correlate', async () => {
    const proxy = localSystemRuntime.factory(context({ toolCallId: undefined })) as Record<
      string,
      (a: any) => any
    >;

    await proxy[LocalSystemApiName.runCommand]({ command: 'sleep 600' });

    expect(dispatchedParams().completion).toBeUndefined();
  });
});

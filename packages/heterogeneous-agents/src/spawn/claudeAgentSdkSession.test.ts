import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeAgentSdkSession } from './claudeAgentSdkSession';

const { closeQuery, query } = vi.hoisted(() => ({
  closeQuery: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query }));

describe('ClaudeAgentSdkSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('LOBE_CLAUDE_CODE_SDK_INACTIVITY_TIMEOUT_MS', '10');
    closeQuery.mockReset();
    query.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('reports a silent query as stale without terminating it', async () => {
    let resolveNext: ((result: IteratorResult<unknown>) => void) | undefined;
    const next = vi.fn(
      () =>
        new Promise<IteratorResult<unknown>>((resolve) => {
          resolveNext = resolve;
        }),
    );
    closeQuery.mockImplementation(() => resolveNext?.({ done: true, value: undefined }));
    query.mockReturnValue({
      [Symbol.asyncIterator]: () => ({ next }),
      close: closeQuery,
    });

    const statuses: string[] = [];
    const session = new ClaudeAgentSdkSession({
      args: [],
      commandPath: '/usr/local/bin/claude',
      cwd: '/tmp',
      env: {},
      onEvents: vi.fn(),
      onRawMessage: vi.fn(),
      onRuntimeStatus: ({ state }) => statuses.push(state),
      onSessionId: vi.fn(),
      onStderr: vi.fn(),
      operationId: 'op-test',
      sessionId: 'session-test',
      stdinPayload: '{"type":"user","message":{"role":"user","content":"test"}}',
    });

    const run = session.run();
    await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());

    await vi.advanceTimersByTimeAsync(10);

    expect(statuses).toContain('stale');
    expect(closeQuery).not.toHaveBeenCalled();

    session.close();
    await run;
    expect(closeQuery).toHaveBeenCalledOnce();
  });
});

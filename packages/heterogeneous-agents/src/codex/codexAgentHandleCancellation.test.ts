import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCodexAgentHandle } from './codexAgentHandle';
import { CodexAppServerClient } from './CodexAppServerClient';

/** @example A Stop received while materializing input must prevent native startup. */
describe('native device startup cancellation', () => {
  afterEach(() => vi.restoreAllMocks());

  /** @example A single queued SIGINT closes the real session without starting Codex. */
  it('does not start a native session when startup control delivers a queued Stop', async () => {
    // ROOT CAUSE:
    // Input materialization can finish after Stop. Registering startup control then
    // calls interrupt before run; the real idle session ignores that interrupt.
    // Starting run afterwards previously launched a turn despite the queued Stop.
    // Keep the real session state machine and intercept only the process boundary.
    const connect = vi
      .spyOn(CodexAppServerClient.prototype, 'connect')
      .mockRejectedValue(new Error('A cancelled operation must never connect'));
    const handle = await createCodexAgentHandle({
      args: [],
      clientVersion: '0.0.61',
      commandPath: 'codex',
      cwd: process.cwd(),
      env: {},
      onStartupControl: ({ cancel }) => {
        void cancel('SIGINT');
      },
      operationId: 'cancelled-device-operation',
      prompt: 'already materialized input',
    });
    const exit = await handle.exit;
    /** @example Cancellation is terminal without creating a native process. */
    expect(connect).not.toHaveBeenCalled();
    /** @example The ingest lifecycle receives the original cancellation signal. */
    expect(exit).toEqual({ code: null, signal: 'SIGINT' });
  });
});

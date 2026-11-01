import { describe, expect, it } from 'vitest';

import { isSessionTerminalEvent } from './terminalEvent';

const event = (type: string, data?: unknown) =>
  ({ data, operationId: 'op-1', stepIndex: 0, timestamp: 1, type }) as any;

describe('isSessionTerminalEvent', () => {
  it('ends the session on the run end and on ordinary errors', () => {
    expect(isSessionTerminalEvent(event('agent_runtime_end'))).toBe(true);
    expect(isSessionTerminalEvent(event('error', { message: 'boom' }))).toBe(true);
  });

  it.each(['claim_timeout', 'no_executor', 'not_delivered'])(
    'keeps the session open for a parked LLM call (%s)',
    (reason) => {
      expect(
        isSessionTerminalEvent(
          event('error', { body: { reason }, error: 'ClientLlmExecutorUnavailable' }),
        ),
      ).toBe(false);
      expect(
        isSessionTerminalEvent(
          event('error', { body: { reason }, errorType: 'ClientLlmExecutorUnavailable' }),
        ),
      ).toBe(false);
    },
  );

  it('ends the session for unavailable reasons the run does not wait on', () => {
    for (const reason of ['relay_unsupported', 'wait_timeout']) {
      expect(
        isSessionTerminalEvent(
          event('error', { body: { reason }, error: 'ClientLlmExecutorUnavailable' }),
        ),
      ).toBe(true);
    }
  });

  it('ignores non-terminal event types', () => {
    expect(isSessionTerminalEvent(event('stream_chunk'))).toBe(false);
  });
});

import { AgentRuntimeErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { readClientLlmWait } from './clientLlmWait';

describe('readClientLlmWait', () => {
  it('reads a waiting_for_client notice off the assistant row', () => {
    expect(
      readClientLlmWait({
        body: {
          expiresAt: '2026-10-04T08:10:00.000Z',
          provider: 'lmstudio',
          waitingForClient: true,
        },
        message: 'Waiting',
        type: AgentRuntimeErrorType.ClientLlmExecutorUnavailable,
      }),
    ).toEqual({
      expiresAt: '2026-10-04T08:10:00.000Z',
      provider: 'lmstudio',
      waitingForClient: true,
    });
  });

  it('leaves a final unavailable error (the wait ran out) to the regular error card', () => {
    expect(
      readClientLlmWait({
        body: { provider: 'lmstudio', reason: 'wait_timeout' },
        message: 'No client',
        type: AgentRuntimeErrorType.ClientLlmExecutorUnavailable,
      }),
    ).toBeUndefined();
    expect(
      readClientLlmWait({
        body: { provider: 'lmstudio', waitingForClient: true },
        message: 'other',
        type: AgentRuntimeErrorType.ProviderBizError,
      }),
    ).toBeUndefined();
    expect(readClientLlmWait(null)).toBeUndefined();
  });
});

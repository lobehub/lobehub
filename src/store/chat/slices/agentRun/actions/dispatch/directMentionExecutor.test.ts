import { AgentRuntimeErrorType, ChatErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { toDirectMentionMessageError } from './directMentionExecutor';

describe('toDirectMentionMessageError', () => {
  it('maps an offline execution device to the actionable device-gateway error', () => {
    const error = toDirectMentionMessageError(
      new Error('{"error":"DEVICE_OFFLINE","success":false}'),
    );

    expect(error).toEqual({ type: ChatErrorType.DeviceGatewayNotConfigured });
  });

  it('keeps unexpected failures on the generic agent-runtime error path', () => {
    expect(toDirectMentionMessageError(new Error('gateway exploded'))).toEqual({
      body: { message: 'gateway exploded' },
      message: 'gateway exploded',
      type: AgentRuntimeErrorType.AgentRuntimeError,
    });
  });
});

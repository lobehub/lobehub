import { describe, expect, it } from 'vitest';

import { toCreateOrigin } from './origin';

describe('toCreateOrigin', () => {
  it('sends no origin when no origin flag is set', () => {
    expect(toCreateOrigin({})).toBeUndefined();
    expect(toCreateOrigin({ originAgent: '  ' })).toBeUndefined();
  });

  it('builds the origin from trimmed flags, dropping blank optional ids', () => {
    expect(
      toCreateOrigin({
        originAgent: ' agt_1 ',
        originMessage: 'msg_1',
        originOperation: '',
        originToolCall: 'call_1',
        originTopic: 'tpc_1',
      }),
    ).toEqual({ agentId: 'agt_1', messageId: 'msg_1', toolCallId: 'call_1', topicId: 'tpc_1' });
  });

  it('requires agent and topic together', () => {
    expect(() => toCreateOrigin({ originTopic: 'tpc_1' })).toThrow(
      '--origin-agent and --origin-topic must be given together',
    );
    expect(() => toCreateOrigin({ originAgent: 'agt_1' })).toThrow();
    expect(() => toCreateOrigin({ originMessage: 'msg_1' })).toThrow();
  });
});

import { describe, expect, it } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { selectThreadTranscript } from './threadTranscript';

const target = { agentId: 'agt_xw', threadId: 'thd_1', topicId: 'tpc_1' };
const reply = [{ content: 'hi', id: 'm1', role: 'assistant', threadId: 'thd_1' }] as any[];

describe('selectThreadTranscript', () => {
  it('reads a thread the tab runs itself from the sub-agent scope', () => {
    const key = messageMapKey({ ...target, scope: 'sub_agent', subAgentId: target.agentId });

    expect(selectThreadTranscript(target)({ dbMessagesMap: { [key]: reply } })).toBe(reply);
  });

  it('reads a Gateway-streamed thread from the thread scope', () => {
    const key = messageMapKey({ ...target, scope: 'thread' });

    expect(selectThreadTranscript(target)({ dbMessagesMap: { [key]: reply } })).toBe(reply);
  });
});

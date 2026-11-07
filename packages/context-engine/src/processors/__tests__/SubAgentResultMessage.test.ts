import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { SubAgentResultMessageProcessor } from '../SubAgentResultMessage';

describe('SubAgentResultMessageProcessor', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  // The chat shows the sub-agent speaking; the model must read it as that
  // sub-agent reporting back, not as the human, with the id it can follow up with.
  it('wraps a sub-agent result message with its id, name and status', async () => {
    const result = await new SubAgentResultMessageProcessor().process(
      createContext([
        { content: 'Write a poem in the background', role: 'user' },
        {
          content: 'Found three sources.\n',
          metadata: {
            subAgentCallback: { name: 'Research "X"', status: 'completed', threadId: 'thd_1' },
          },
          role: 'user',
        },
      ]),
    );

    expect(result.messages[0].content).toBe('Write a poem in the background');
    expect(result.messages[1]).toMatchObject({
      content:
        '<sub_agent_result id="thd_1" name="Research &quot;X&quot;" status="completed">\nFound three sources.\n</sub_agent_result>',
      role: 'user',
    });
    expect(result.metadata.subAgentResultMessagesWrapped).toBe(1);
  });

  it('carries a failure into the status', async () => {
    const result = await new SubAgentResultMessageProcessor().process(
      createContext([
        {
          content: 'Budget exceeded',
          metadata: { subAgentCallback: { name: 'Poet', status: 'error', threadId: 'thd_2' } },
          role: 'user',
        },
      ]),
    );

    expect(result.messages[0].content).toContain('status="error"');
  });
});

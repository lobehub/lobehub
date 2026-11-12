import type { ContextBuildInput } from '@lobechat/agent-runtime';
import { countRequestPayloadTokens } from '@lobechat/context-engine';
import { describe, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';
import { ServerContextBuilder } from './ServerContextBuilder';

const processedMessages = [
  { content: 'You are a careful analyst.', role: 'system' },
  { content: 'read the file', role: 'user' },
  {
    content: '',
    role: 'assistant',
    tool_calls: [
      {
        function: { arguments: '{"fileId":"file_1"}', name: 'readAttachment' },
        id: 'call_1',
        type: 'function',
      },
    ],
  },
  { content: 'line of the file\n'.repeat(50), role: 'tool', tool_call_id: 'call_1' },
];
const tools = [
  {
    function: { description: 'Read an attachment', name: 'readAttachment', parameters: {} },
    type: 'function',
  },
];

vi.mock('./serverCallLlmTooling', () => ({
  resolveServerCallLlmTooling: () => ({
    resolved: {
      enabledToolIds: ['lobe-attachments'],
      manifestMap: {},
      promptManifestMap: {},
      sourceMap: {},
      tools,
    },
  }),
}));

vi.mock('./serverCallLlmContextBuilder', () => ({
  buildServerCallLlmContext: async () => ({
    processedMessages,
    shouldReplayAssistantReasoning: false,
  }),
}));

describe('ServerContextBuilder', () => {
  it('accounts the request it builds from the processed messages and sent tools', async () => {
    const builder = new ServerContextBuilder({} as RuntimeExecutorContext);

    const output = await builder.build({
      model: 'deepseek-v4-flash',
      payload: { messages: [] },
      provider: 'deepseek',
      state: {},
    } as unknown as ContextBuildInput);

    expect(output.messages).toBe(processedMessages);
    expect(output.contextAccounting).toEqual(
      countRequestPayloadTokens({ messages: processedMessages, tools }),
    );
    expect(output.contextAccounting?.bySource.toolDefinition).toBeGreaterThan(0);
    expect(output.contextAccounting?.bySource.toolCalls).toBeGreaterThan(0);
  });
});

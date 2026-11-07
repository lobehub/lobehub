import { describe, expect, it } from 'vitest';

import { chainCompressConversation } from './compressContext';

describe('chainCompressConversation', () => {
  it('renders the engine-built conversation without its system messages', () => {
    const payload = chainCompressConversation([
      { content: 'You are a coding agent. <user_memory>likes tea</user_memory>', role: 'system' },
      {
        content: '<compressed_history_summary>\nEarlier work\n</compressed_history_summary>',
        role: 'user',
      },
      { content: 'List the files', role: 'user' },
      {
        content: '',
        role: 'assistant',
        tool_calls: [
          {
            function: { arguments: '{"command":"ls"}', name: 'runCommand' },
            id: 'c1',
            type: 'function',
          },
        ],
      },
      { content: 'a.ts\n...[trimmed]', name: 'runCommand', role: 'tool', tool_call_id: 'c1' },
      {
        content: [
          { text: 'Here is a screenshot', type: 'text' },
          { image_url: { url: 'data:image/png;base64,AAAA' }, type: 'image_url' },
        ],
        role: 'user',
      },
    ]);

    const history = payload.messages![1].content as string;

    expect(payload.messages![0].role).toBe('system');
    expect(history).not.toContain('You are a coding agent');
    expect(history).toContain('<compressed_history_summary>\nEarlier work');
    expect(history).toContain('<user>List the files</user>');
    expect(history).toContain(
      '<assistant><tool_call name="runCommand">{"command":"ls"}</tool_call></assistant>',
    );
    expect(history).toContain('<tool_result name="runCommand">a.ts\n...[trimmed]</tool_result>');
    expect(history).toContain('<user>Here is a screenshot\n[image]</user>');
    expect(history).not.toContain('base64');
  });
});

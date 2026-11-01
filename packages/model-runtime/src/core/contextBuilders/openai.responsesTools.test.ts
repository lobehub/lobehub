import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import { convertOpenAIResponseInputs } from './openai';

export const nativeTools: OpenAI.Responses.Tool[] = [
  {
    type: 'namespace',
    name: 'functions',
    description: '',
    tools: [{ type: 'custom', name: 'exec', format: { type: 'text' } }],
  },
];

describe('Responses native tools', () => {
  it('retains dynamic tools in order, raw custom input, namespace, and matching custom outputs', async () => {
    const input = await convertOpenAIResponseInputs(
      [
        { role: 'user', content: 'Read file' },
        { role: 'system', content: '', responsesTools: nativeTools },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'custom-1',
              type: 'custom',
              namespace: 'functions',
              function: { name: 'exec', arguments: 'read("probe.txt")' },
            },
            {
              id: 'function-1',
              type: 'function',
              namespace: 'clock',
              function: { name: 'now', arguments: '{}' },
            },
            { id: 'unpaired', type: 'custom', function: { name: 'exec', arguments: 'drop' } },
          ],
        },
        { role: 'tool', content: 'file contents', tool_call_id: 'custom-1' },
        { role: 'tool', content: 'time', tool_call_id: 'function-1' },
        { role: 'tool', content: 'drop', tool_call_id: 'orphan' },
      ],
      { strictToolPairing: true },
    );
    expect(input).toEqual([
      { role: 'user', content: 'Read file' },
      { type: 'additional_tools', role: 'developer', tools: nativeTools },
      {
        type: 'custom_tool_call',
        call_id: 'custom-1',
        name: 'exec',
        namespace: 'functions',
        input: 'read("probe.txt")',
      },
      {
        type: 'function_call',
        call_id: 'function-1',
        name: 'now',
        namespace: 'clock',
        arguments: '{}',
      },
      { type: 'custom_tool_call_output', call_id: 'custom-1', output: 'file contents' },
      { type: 'function_call_output', call_id: 'function-1', output: 'time' },
    ]);
  });
  it('replays native text, image and file tool-output parts without stringification or relocation', async () => {
    const output: OpenAI.Responses.ResponseCustomToolCallOutput['output'] = [
      { type: 'input_text', text: 'contents' },
      { type: 'input_image', image_url: 'https://example.com/image.png', detail: 'high' },
      { type: 'input_file', file_id: 'file-1' },
    ];
    const result = await convertOpenAIResponseInputs(
      [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call-1', type: 'custom', function: { name: 'exec', arguments: 'read()' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'contents', responsesOutput: output },
      ],
      { strictToolPairing: true },
    );
    expect(result[1]).toEqual({ type: 'custom_tool_call_output', call_id: 'call-1', output });
  });
});

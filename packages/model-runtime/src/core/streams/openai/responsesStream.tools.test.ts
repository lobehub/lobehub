import { describe, expect, it } from 'vitest';

import { createReadableStream } from '../utils';
import { OpenAIResponsesStream } from './responsesStream';

describe('Responses custom tool streaming', () => {
  it('keeps interleaved custom/function deltas attached to their own calls', async () => {
    const stream = OpenAIResponsesStream(
      createReadableStream([
        { type: 'response.created', response: { id: 'response-1', status: 'in_progress' } },
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: {
            id: 'ct-1',
            type: 'custom_tool_call',
            call_id: 'call-1',
            namespace: 'functions',
            name: 'exec',
            input: '',
          },
        },
        {
          type: 'response.output_item.added',
          output_index: 2,
          item: {
            id: 'fc-1',
            type: 'function_call',
            call_id: 'call-2',
            namespace: 'clock',
            name: 'now',
            arguments: '',
          },
        },
        {
          type: 'response.custom_tool_call_input.delta',
          output_index: 1,
          item_id: 'ct-1',
          delta: 'read(',
        },
        {
          type: 'response.function_call_arguments.delta',
          output_index: 2,
          item_id: 'fc-1',
          delta: '{}',
        },
        {
          type: 'response.custom_tool_call_input.delta',
          output_index: 1,
          item_id: 'ct-1',
          delta: '"probe.txt")',
        },
      ]),
    );
    const raw = await new Response(stream).text();
    const calls = raw
      .split('\n\n')
      .filter((block) => block.includes('event: tool_calls'))
      .flatMap((block) =>
        JSON.parse(
          block
            .split('\n')
            .find((line) => line.startsWith('data: '))!
            .slice(6),
        ),
      );
    expect(calls.map((call) => [call.id, call.index, call.type, call.function.arguments])).toEqual([
      ['call-1', 0, 'custom', ''],
      ['call-2', 1, 'function', ''],
      ['call-1', 0, 'custom', 'read('],
      ['call-2', 1, 'function', '{}'],
      ['call-1', 0, 'custom', '"probe.txt")'],
    ]);
    expect(calls[0].namespace).toBe('functions');
    expect(calls[1].namespace).toBe('clock');
  });
});

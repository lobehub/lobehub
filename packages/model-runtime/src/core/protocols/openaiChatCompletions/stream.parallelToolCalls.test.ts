import { describe, expect, it } from 'vitest';

import type { MessageToolCall } from '../../../types';
import { createReadableStream, readStreamChunk } from '../../streams/utils';
import { OpenAIStream } from './stream';

const toolChunk = (toolCall: Record<string, unknown>) => ({
  choices: [{ delta: { tool_calls: [toolCall] }, index: 0 }],
  id: 'chatcmpl-test',
});

const collectToolCalls = async (chunks: unknown[]) => {
  let final: MessageToolCall[] = [];
  const stream = OpenAIStream(createReadableStream(chunks), {
    callbacks: {
      onToolsCalling: ({ toolsCalling }) => {
        final = toolsCalling;
      },
    },
  });
  await readStreamChunk(stream);
  return final.map((call) => ({
    arguments: call.function.arguments,
    id: call.id,
    name: call.function.name,
  }));
};

/**
 * Parallel tool calls whose opening delta carries the call id but no name
 * (NVIDIA NIM / some OpenAI-compatible proxies send `name: null` as a
 * start-of-call marker). Continuation deltas carry only `index`. They must be
 * routed by index to their own call, not to the first call's id — otherwise
 * every call after the first finishes with empty arguments ("the arguments of
 * this call arrived empty") and the first gets the concatenation of all.
 */
describe('OpenAIStream parallel tool calls without name on the opening delta', () => {
  it('routes index-only argument deltas to their own call', async () => {
    const result = await collectToolCalls([
      toolChunk({ function: { arguments: '', name: null }, id: 'call_a', index: 0 }),
      toolChunk({ function: { name: 'readFile' }, index: 0 }),
      toolChunk({ function: { arguments: '{"path":"/a"}' }, index: 0 }),
      toolChunk({ function: { arguments: '', name: null }, id: 'call_b', index: 1 }),
      toolChunk({ function: { name: 'readFile' }, index: 1 }),
      toolChunk({ function: { arguments: '{"path":"/b"}' }, index: 1 }),
      toolChunk({ function: { arguments: '', name: null }, id: 'call_c', index: 2 }),
      toolChunk({ function: { name: 'grep' }, index: 2 }),
      toolChunk({ function: { arguments: '{"pattern":"x"}' }, index: 2 }),
    ]);

    expect(result).toEqual([
      { arguments: '{"path":"/a"}', id: 'call_a', name: 'readFile' },
      { arguments: '{"path":"/b"}', id: 'call_b', name: 'readFile' },
      { arguments: '{"pattern":"x"}', id: 'call_c', name: 'grep' },
    ]);
  });

  it('routes interleaved index-only deltas when names arrive with the id', async () => {
    const result = await collectToolCalls([
      toolChunk({ function: { arguments: '', name: 'readFile' }, id: 'call_a', index: 0 }),
      toolChunk({ function: { arguments: '', name: 'grep' }, id: 'call_b', index: 1 }),
      toolChunk({ function: { arguments: '{"path":' }, index: 0 }),
      toolChunk({ function: { arguments: '{"pattern":"x"}' }, index: 1 }),
      toolChunk({ function: { arguments: '"/a"}' }, index: 0 }),
    ]);

    expect(result).toEqual([
      { arguments: '{"path":"/a"}', id: 'call_a', name: 'readFile' },
      { arguments: '{"pattern":"x"}', id: 'call_b', name: 'grep' },
    ]);
  });
});

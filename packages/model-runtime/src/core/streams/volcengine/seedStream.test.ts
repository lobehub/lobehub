import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import type { StreamContext } from '../protocol';
import { transformVolcengineSeedStream } from './seedStream';

const INJECT_CREDS_BLOCK =
  'seed:tool_call<function name="lobe-creds____injectCredsToSandbox"><parameter name="keys" string="false">["shuyou"]</parameter></function></seed:tool_call>';

const seedPayload = {
  model: 'doubao-seed-2.0-pro',
  tools: [
    { function: { name: 'lobe-creds____injectCredsToSandbox', parameters: {} }, type: 'function' },
  ],
};

describe('transformVolcengineSeedStream', () => {
  it('should convert seed:tool_call text into tool_calls for doubao-seed models', () => {
    const streamContext: StreamContext = { id: 'resp-1' };
    const chunk = {
      choices: [{ delta: { content: INJECT_CREDS_BLOCK }, finish_reason: null, index: 0 }],
      id: 'resp-1',
      object: 'chat.completion.chunk',
    } as OpenAI.ChatCompletionChunk;

    const result = transformVolcengineSeedStream(chunk, streamContext, seedPayload);
    const chunks = Array.isArray(result) ? result : [result];
    const toolChunk = chunks.find((item) => item.type === 'tool_calls');

    expect(toolChunk?.data[0].function).toEqual({
      arguments: JSON.stringify({ keys: ['shuyou'] }),
      name: 'lobe-creds____injectCredsToSandbox',
    });
  });

  it('should pass through native tool_calls unchanged', () => {
    const streamContext: StreamContext = { id: 'resp-2' };
    const chunk = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                function: {
                  arguments: '{"keys":["shuyou"]}',
                  name: 'lobe-creds____injectCredsToSandbox',
                },
                id: 'call_native',
                index: 0,
                type: 'function',
              },
            ],
          },
          finish_reason: null,
          index: 0,
        },
      ],
      id: 'resp-2',
      object: 'chat.completion.chunk',
    } as OpenAI.ChatCompletionChunk;

    const result = transformVolcengineSeedStream(chunk, streamContext, seedPayload);
    const chunks = Array.isArray(result) ? result : [result];

    expect(chunks[0]?.type).toBe('tool_calls');
    expect(chunks[0]?.data[0].function.name).toBe('lobe-creds____injectCredsToSandbox');
  });

  it('should not rewrite text for non-seed models', () => {
    const streamContext: StreamContext = { id: 'resp-3' };
    const chunk = {
      choices: [{ delta: { content: INJECT_CREDS_BLOCK }, finish_reason: null, index: 0 }],
      id: 'resp-3',
      object: 'chat.completion.chunk',
    } as OpenAI.ChatCompletionChunk;

    const result = transformVolcengineSeedStream(chunk, streamContext, {
      model: 'doubao-pro-32k',
      tools: seedPayload.tools,
    });
    const chunks = Array.isArray(result) ? result : [result];

    expect(chunks[0]).toEqual({ data: INJECT_CREDS_BLOCK, id: 'resp-3', type: 'text' });
  });

  it('should flush buffered seed tool call on finish_reason', () => {
    const streamContext: StreamContext = { id: 'resp-4', seedToolCallBuffer: INJECT_CREDS_BLOCK };
    const chunk = {
      choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
      id: 'resp-4',
      object: 'chat.completion.chunk',
    } as OpenAI.ChatCompletionChunk;

    const result = transformVolcengineSeedStream(chunk, streamContext, seedPayload);
    const chunks = Array.isArray(result) ? result : [result];
    const toolChunk = chunks.find((item) => item.type === 'tool_calls');

    expect(streamContext.seedToolCallBuffer).toBe('');
    expect(toolChunk?.data[0].function.name).toBe('lobe-creds____injectCredsToSandbox');
  });
});

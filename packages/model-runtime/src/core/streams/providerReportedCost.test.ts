import { describe, expect, it, vi } from 'vitest';

import { AnthropicStream } from './anthropic';
import { OpenAIStream } from './openai/openai';
import { OpenAIResponsesStream } from './openai/responsesStream';
import { readProviderReportedCost } from './providerReportedCost';

const createStream = (chunks: unknown[]) =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

const readAll = async (stream: ReadableStream<Uint8Array>) => {
  const decoder = new TextDecoder();
  let output = '';
  // @ts-ignore
  for await (const chunk of stream) output += decoder.decode(chunk, { stream: true });
  return output;
};

describe('readProviderReportedCost', () => {
  it('reads OpenRouter usage.cost', () => {
    expect(readProviderReportedCost({ usage: { cost: 0.000_150_48 } })).toBe(0.000_150_48);
  });

  it('reads the Vercel gateway cost decimal string', () => {
    expect(readProviderReportedCost({ provider_metadata: { gateway: { cost: '0.000076' } } })).toBe(
      0.000_076,
    );
  });

  it('reads costs nested in Anthropic message and Responses response objects', () => {
    expect(readProviderReportedCost({ message: { usage: { cost: 0.2 } } })).toBe(0.2);
    expect(
      readProviderReportedCost({ response: { provider_metadata: { gateway: { cost: '0.3' } } } }),
    ).toBe(0.3);
  });

  it('ignores missing, empty, negative and non-numeric values', () => {
    expect(readProviderReportedCost(undefined)).toBeUndefined();
    expect(readProviderReportedCost({ usage: { prompt_tokens: 1 } })).toBeUndefined();
    expect(
      readProviderReportedCost({ provider_metadata: { gateway: { cost: '' } } }),
    ).toBeUndefined();
    expect(readProviderReportedCost({ usage: { cost: -1 } })).toBeUndefined();
    expect(readProviderReportedCost({ usage: { cost: 'n/a' } })).toBeUndefined();
  });
});

describe('provider-reported cost in stream callbacks', () => {
  it('passes OpenAI Chat Completions usage.cost to onFinal without streaming it', async () => {
    const onFinal = vi.fn();
    const output = await readAll(
      OpenAIStream(
        createStream([
          { choices: [{ delta: { content: 'hi' }, index: 0 }], id: 'c1' },
          { choices: [{ delta: {}, finish_reason: 'stop', index: 0 }], id: 'c1' },
          {
            choices: [],
            id: 'c1',
            usage: { completion_tokens: 6, cost: 0.000_088_11, prompt_tokens: 8, total_tokens: 14 },
          },
        ]),
        { callbacks: { onFinal } },
      ),
    );

    expect(onFinal).toHaveBeenCalledWith(
      expect.objectContaining({ providerReportedCost: 0.000_088_11 }),
    );
    expect(output).not.toContain('0.00008811');
  });

  it('passes the Vercel gateway cost on Responses completion to onFinal', async () => {
    const onFinal = vi.fn();
    const output = await readAll(
      OpenAIResponsesStream(
        createStream([
          { response: { id: 'r1', status: 'in_progress' }, type: 'response.created' },
          {
            response: {
              id: 'r1',
              provider_metadata: { gateway: { cost: '0.000076' } },
              status: 'completed',
              usage: { input_tokens: 8, output_tokens: 6, total_tokens: 14 },
            },
            type: 'response.completed',
          },
        ]),
        { callbacks: { onFinal } },
      ),
    );

    expect(onFinal).toHaveBeenCalledWith(
      expect.objectContaining({ providerReportedCost: 0.000_076 }),
    );
    expect(output).not.toContain('0.000076');
  });

  it('passes the final Anthropic message_delta cost and pricing options to onFinal', async () => {
    const onFinal = vi.fn();
    const pricingOptions = { lookupParams: { ttl: '1h' } };
    await readAll(
      AnthropicStream(
        createStream([
          {
            message: { id: 'm1', usage: { input_tokens: 8, output_tokens: 1 } },
            type: 'message_start',
          },
          { delta: { text: 'hi', type: 'text_delta' }, index: 0, type: 'content_block_delta' },
          {
            delta: { stop_reason: 'end_turn' },
            provider_metadata: { gateway: { cost: '0.00012' } },
            type: 'message_delta',
            usage: { output_tokens: 6 },
          },
          { type: 'message_stop' },
        ]),
        { callbacks: { onFinal }, payload: { model: 'claude', pricingOptions, provider: 'x' } },
      ),
    );

    expect(onFinal).toHaveBeenCalledWith(
      expect.objectContaining({ pricingOptions, providerReportedCost: 0.000_12 }),
    );
  });

  it('omits providerReportedCost when the provider reports none', async () => {
    const onFinal = vi.fn();
    await readAll(
      OpenAIStream(
        createStream([
          { choices: [{ delta: { content: 'hi' }, finish_reason: 'stop', index: 0 }], id: 'c1' },
        ]),
        { callbacks: { onFinal } },
      ),
    );

    expect(onFinal.mock.calls[0][0]).not.toHaveProperty('providerReportedCost');
  });
});

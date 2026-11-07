import { expect, it, vi } from 'vitest';

import { createReadableStream } from '../utils';
import { OpenAIResponsesStream } from './responsesStream';

it.each([true, false])('surfaces a refusal exactly once (with deltas: %s)', async (withDeltas) => {
  const refusal = 'I cannot help with that request.';
  const part = { content_index: 0, item_id: 'msg_1', output_index: 0 };
  const item = {
    content: [{ refusal, type: 'refusal' }],
    id: part.item_id,
    role: 'assistant',
    status: 'completed',
    type: 'message',
  };
  const onText = vi.fn();
  const onFinal = vi.fn();
  const stream = OpenAIResponsesStream(
    createReadableStream([
      { response: { id: 'resp_1', status: 'in_progress' }, type: 'response.created' },
      ...(withDeltas
        ? [
            { ...part, delta: 'I cannot help', type: 'response.refusal.delta' },
            { ...part, delta: ' with that request.', type: 'response.refusal.delta' },
          ]
        : []),
      { ...part, refusal, type: 'response.refusal.done' },
      { item, output_index: 0, type: 'response.output_item.done' },
      {
        response: { id: 'resp_1', output: [item], status: 'completed' },
        type: 'response.completed',
      },
    ]),
    { callbacks: { onFinal, onText } },
  );
  await new Response(stream).text();

  expect(onText.mock.calls.map(([text]) => text)).toEqual(
    withDeltas ? ['I cannot help', ' with that request.'] : [refusal],
  );
  expect(onFinal).toHaveBeenCalledWith(expect.objectContaining({ text: refusal }));
});

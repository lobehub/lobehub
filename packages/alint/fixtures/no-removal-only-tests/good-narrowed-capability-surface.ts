// Fixture: a new provider runtime that exposes only one capability of its factory.
import { expect, it, vi } from 'vitest';

import { DecisionProviderAI } from './index';

it('calls the decision endpoint', async () => {
  const runtime = new DecisionProviderAI({ apiKey: 'test-key' });
  const post = vi.spyOn(runtime['client'], 'post').mockResolvedValue({
    answers: { approve: { noul: 0.9, type: 'noul' } },
  } as never);

  const result = await runtime.decide({ questions: { approve: { type: 'boolean' } } });

  expect(post).toHaveBeenCalledWith('/systemone', expect.anything());
  expect(result.answers.approve).toMatchObject({ probability: 0.9 });
});

it('does not expose unsupported OpenAI-compatible capabilities', () => {
  const runtime = new DecisionProviderAI({ apiKey: 'test-key' });

  expect(runtime.chat).toBeUndefined();
  expect(runtime.embeddings).toBeUndefined();
  expect(runtime.models).toBeUndefined();
});

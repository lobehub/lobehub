import { describe, expect, it } from 'vitest';

import { getOllamaErrorMessage, getUnresolvedOllamaModel } from './parseOllamaError';

const error = (body: unknown, message = 'error') =>
  ({ body, message, type: 'OllamaBizError' }) as any;

describe('getUnresolvedOllamaModel', () => {
  it('reads a single-quoted model name, as current Ollama reports it', () => {
    expect(
      getUnresolvedOllamaModel(
        error({ error: { message: "model 'smollm2:135m' not found" }, provider: 'ollama' }),
      ),
    ).toBe('smollm2:135m');
  });

  it('still reads the double-quoted form', () => {
    expect(
      getUnresolvedOllamaModel(error({ error: { message: 'model "llama3.2:3b" not found' } })),
    ).toBe('llama3.2:3b');
  });

  it('falls back to the body and error messages', () => {
    expect(getUnresolvedOllamaModel(error({ message: "model 'a:1b' not found" }))).toBe('a:1b');
    expect(getUnresolvedOllamaModel(error(undefined, "model 'b:2b' not found"))).toBe('b:2b');
  });

  it('returns nothing for other Ollama errors', () => {
    expect(getUnresolvedOllamaModel(error({ error: { message: 'Failed to fetch' } }))).toBe(
      undefined,
    );
    expect(getOllamaErrorMessage(error({ error: { message: 'Failed to fetch' } }))).toBe(
      'Failed to fetch',
    );
  });
});

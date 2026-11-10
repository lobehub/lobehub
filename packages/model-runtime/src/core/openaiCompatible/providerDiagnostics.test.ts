import { describe, expect, it } from 'vitest';

import {
  initializeOpenAIDiagnostics,
  recordOpenAIChatCompletionChunk,
  recordOpenAIChatCompletionResponse,
} from './providerDiagnostics';

const createDiagnostics = () =>
  initializeOpenAIDiagnostics({
    apiMode: 'chatCompletion',
    diagnostics: {} as any,
    endpoint: 'https://example.test/v1/chat/completions',
    payload: {},
    sentAt: Date.now(),
  })!;

describe('providerDiagnostics choices guard', () => {
  // OpenAI-compatible proxies send keep-alive / usage-only / error frames whose
  // `choices` is absent or null. Diagnostics is observability — it must never be
  // what fails the request.
  const malformed = [
    ['absent', {}],
    ['null', { choices: null }],
    ['an object', { choices: { 0: {} } }],
    ['a string', { choices: '' }],
  ] as const;

  it.each(malformed)('survives a stream chunk whose choices is %s', (_label, shape) => {
    const diagnostics = createDiagnostics();

    expect(() =>
      recordOpenAIChatCompletionChunk(diagnostics, { id: 'c1', ...shape } as any),
    ).not.toThrow();
  });

  it.each(malformed)('survives a completion whose choices is %s', async (_label, shape) => {
    const diagnostics = createDiagnostics();

    await expect(
      recordOpenAIChatCompletionResponse(diagnostics, { id: 'c1', ...shape } as any),
    ).resolves.not.toThrow();
  });

  it('still records content from a well-formed chunk', () => {
    const diagnostics = createDiagnostics();

    recordOpenAIChatCompletionChunk(diagnostics, {
      choices: [{ delta: { content: 'hello' }, index: 0 }],
      id: 'c1',
    } as any);

    expect(diagnostics.textChars).toBe(5);
    expect(diagnostics.hasNonWhitespaceText).toBe(true);
  });
});

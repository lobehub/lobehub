// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { CompletionLifecycle } from '../CompletionLifecycle';

const buildLifecycle = () => new CompletionLifecycle({} as any, 'user-1');

describe('CompletionLifecycle.extractErrorMessage', () => {
  it('extracts message from ChatCompletionErrorPayload (InsufficientBudgetForModel)', () => {
    const lifecycle = buildLifecycle();
    const error = {
      _responseBody: { provider: 'lobehub' },
      error: { message: 'Budget exceeded' },
      errorType: 'InsufficientBudgetForModel',
      provider: 'lobehub',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('Budget exceeded');
  });

  it('extracts message from ChatCompletionErrorPayload (InvalidProviderAPIKey)', () => {
    const lifecycle = buildLifecycle();
    const error = {
      endpoint: 'https://cdn.example.com/v1',
      error: {
        code: '',
        error: { code: '', message: '无效的令牌', type: 'new_api_error' },
        message: '无效的令牌',
        status: 401,
        type: 'new_api_error',
      },
      errorType: 'InvalidProviderAPIKey',
      provider: 'openai',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('无效的令牌');
  });

  it('extracts message from formatted ChatMessageError with body.error.message', () => {
    const lifecycle = buildLifecycle();
    const error = {
      body: { error: { message: 'Rate limit exceeded' } },
      message: 'InvalidProviderAPIKey',
      type: 'InvalidProviderAPIKey',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('Rate limit exceeded');
  });

  it('extracts message from ChatMessageError with body.message', () => {
    const lifecycle = buildLifecycle();
    const error = {
      body: { message: 'Something went wrong' },
      message: 'error',
      type: 'InternalServerError',
    };

    expect(lifecycle.extractErrorMessage(error)).toBe('Something went wrong');
  });

  it('falls back to error.message when body is absent', () => {
    const lifecycle = buildLifecycle();
    const error = { message: 'Connection timeout', type: 'NetworkError' };

    expect(lifecycle.extractErrorMessage(error)).toBe('Connection timeout');
  });

  it('falls back to errorType when message is "error"', () => {
    const lifecycle = buildLifecycle();
    const error = { errorType: 'InsufficientBudgetForModel', message: 'error' };

    expect(lifecycle.extractErrorMessage(error)).toBe('InsufficientBudgetForModel');
  });

  it('returns undefined for null/undefined', () => {
    const lifecycle = buildLifecycle();

    expect(lifecycle.extractErrorMessage(null)).toBeUndefined();
    expect(lifecycle.extractErrorMessage(undefined)).toBeUndefined();
  });

  it('never returns [object Object] for nested error objects', () => {
    const lifecycle = buildLifecycle();
    const error = {
      _responseBody: { provider: 'lobehub' },
      error: { message: 'Budget exceeded' },
      errorType: 'InsufficientBudgetForModel',
      provider: 'lobehub',
    };

    const result = lifecycle.extractErrorMessage(error);
    expect(result).not.toBe('[object Object]');
    expect(typeof result).toBe('string');
    expect(result).toBe('Budget exceeded');
  });
});

describe('CompletionLifecycle.buildLifecycleEvent', () => {
  const callBuild = (state: unknown, reason = 'completed') =>
    (buildLifecycle() as any).buildLifecycleEvent('op-1', state, reason);

  it('extracts text content from a plain-string final assistant turn', () => {
    const state = {
      messages: [
        { content: 'user prompt', role: 'user' },
        { content: 'final answer', role: 'assistant' },
      ],
      metadata: { agentId: 'agent-1', userId: 'user-1' },
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBe('final answer');
    expect(event.attachments).toBeUndefined();
  });

  it('concatenates text parts from a multimodal final assistant turn', () => {
    const state = {
      messages: [
        {
          content: [
            { text: 'here is the image: ', type: 'text' },
            { image_url: { url: 'https://cdn.example.com/a.png' }, type: 'image_url' },
            { text: '\n\nhope it helps', type: 'text' },
          ],
          role: 'assistant',
        },
      ],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBe('here is the image: \n\nhope it helps');
    expect(event.attachments).toEqual([
      expect.objectContaining({ fetchUrl: 'https://cdn.example.com/a.png', type: 'image' }),
    ]);
  });

  it('returns undefined text for image-only final assistant turn (no fallback to earlier text)', () => {
    // Regression: the previous implementation `.find(m => role === 'assistant' && hasText)`
    // would skip the image-only final turn and walk back to the earlier text
    // turn, shipping stale prose alongside the current image. The fix matches
    // on role only — text must be undefined when the final turn has no text.
    const state = {
      messages: [
        { content: 'stale prior text', role: 'assistant' },
        { content: 'follow-up prompt', role: 'user' },
        {
          content: [{ image_url: { url: 'https://cdn.example.com/new.png' }, type: 'image_url' }],
          role: 'assistant',
        },
      ],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBeUndefined();
    expect(event.attachments).toEqual([
      expect.objectContaining({ fetchUrl: 'https://cdn.example.com/new.png', type: 'image' }),
    ]);
  });

  it('returns undefined text when there are no assistant messages', () => {
    const state = {
      messages: [{ content: 'just a user prompt', role: 'user' }],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBeUndefined();
    expect(event.attachments).toBeUndefined();
  });

  it('returns undefined text when content is an empty string', () => {
    // `extractTextFromMessageContent` returns undefined for empty strings, so
    // an empty-string final assistant turn must not pretend it has text.
    const state = {
      messages: [{ content: '', role: 'assistant' }],
      metadata: {},
    };

    const { event } = callBuild(state);

    expect(event.lastAssistantContent).toBeUndefined();
  });

  it('handles missing messages array gracefully', () => {
    const { event } = callBuild({ metadata: { agentId: 'a' } });

    expect(event.lastAssistantContent).toBeUndefined();
    expect(event.attachments).toBeUndefined();
    expect(event.agentId).toBe('a');
  });
});

import { AgentRuntimeErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { formatErrorForState } from '../formatErrorForState';
import { createStreamExecutionError } from './serverCallLlmAttempt';

describe('createStreamExecutionError', () => {
  // Shape emitted by the Google stream transformer for a terminal policy block.
  const policyBlock = {
    body: {
      context: { finishReason: 'SAFETY' },
      message: 'The content was blocked (SAFETY). Please adjust it and try again.',
      provider: 'google',
    },
    type: AgentRuntimeErrorType.ProviderContentPolicyViolation,
  };

  it('reads the human message out of the nested body instead of stringifying the payload', () => {
    const error = createStreamExecutionError(policyBlock);

    expect(error.message).toBe(
      'LLM stream error: The content was blocked (SAFETY). Please adjust it and try again.',
    );
    expect(error.message).not.toContain('{');
  });

  it('keeps the classification so the error is not recorded as a bare 500', () => {
    const formatted = formatErrorForState(createStreamExecutionError(policyBlock));

    expect(formatted.type).toBe(AgentRuntimeErrorType.ProviderContentPolicyViolation);
  });

  it('keeps the payload body flat so renderers still find provider and context', () => {
    // The conversation error renderer branches on `body.provider === 'google'`
    // and reads `body.context.finishReason`; nesting the payload one level down
    // would silently drop the Google policy view.
    const formatted = formatErrorForState(createStreamExecutionError(policyBlock));

    expect(formatted.body).toMatchObject({
      context: { finishReason: 'SAFETY' },
      provider: 'google',
    });
    expect((formatted.body as { body?: unknown }).body).toBeUndefined();
  });

  it('still prefers a top-level message when the payload is flat', () => {
    const error = createStreamExecutionError({ message: 'terminated' });

    expect(error.message).toBe('LLM stream error: terminated');
  });

  it('ignores provider-vocabulary type values that are not our codes', () => {
    // OpenAI-compatible upstreams pass their own taxonomy through; promoting it
    // would invent a code that no spec can classify.
    const error = createStreamExecutionError({
      error: { message: '500 API error', type: 'api_error' },
      type: 'error',
    });

    expect((error as { errorType?: string }).errorType).toBeUndefined();
  });

  // Shape a provider runtime throws (`AgentRuntimeError.chat`) and a relayed
  // device call reports: the human text sits under `error.message`.
  const ollamaMissingModel = {
    error: { message: "model 'smollm2:135m' not found", name: 'ResponseError', status_code: 404 },
    errorType: AgentRuntimeErrorType.OllamaBizError,
    provider: 'ollama',
  };

  it('reads the message of a provider error from its nested error', () => {
    const error = createStreamExecutionError(ollamaMissingModel);

    expect(error.message).toBe("LLM stream error: model 'smollm2:135m' not found");
  });

  it('keeps a provider error under body.error so the provider error card can read it', () => {
    // The Ollama card reads `body.error.message` to offer downloading the
    // missing model; a stringified payload there left the message blank.
    const formatted = formatErrorForState(createStreamExecutionError(ollamaMissingModel));

    expect(formatted.type).toBe(AgentRuntimeErrorType.OllamaBizError);
    expect(formatted.body).toMatchObject({
      error: { message: "model 'smollm2:135m' not found", status_code: 404 },
      provider: 'ollama',
    });
  });

  it('falls back to stringifying when no message can be found anywhere', () => {
    const error = createStreamExecutionError({ code: 42 });

    expect(error.message).toBe('LLM stream error: {"code":42}');
  });
});

import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { AsyncTaskErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { CONTENT_POLICY_ERROR_MESSAGE } from './contentPolicyError';
import { categorizeImageGenerationError } from './imageError';

describe('categorizeImageGenerationError', () => {
  it('should map runtime content policy violations to async content moderation errors', () => {
    const result = categorizeImageGenerationError({
      error: {
        error: {
          providerReason: 'IMAGE_PROHIBITED_CONTENT',
          reasonCode: 'google_image_content_policy_violation',
        },
        errorType: AgentRuntimeErrorType.ProviderContentPolicyViolation,
      },
      isAborted: false,
      isEditingImage: false,
    });

    expect(result).toEqual({
      errorMessage: CONTENT_POLICY_ERROR_MESSAGE,
      errorType: AsyncTaskErrorType.ProviderContentModeration,
    });
  });

  it('should surface provider text-only image responses as server errors', () => {
    const result = categorizeImageGenerationError({
      error: {
        error: {
          message: "I'm just a language model and can't help with that.",
          reasonCode: 'google_image_text_only_response',
        },
        errorType: AgentRuntimeErrorType.ProviderNoImageGenerated,
      },
      isAborted: false,
      isEditingImage: false,
    });

    expect(result).toEqual({
      errorMessage: "I'm just a language model and can't help with that.",
      errorType: AsyncTaskErrorType.ServerError,
    });
  });

  it('should surface provider text refusal reasons when the runtime classified an explicit refusal', () => {
    const result = categorizeImageGenerationError({
      error: {
        error: {
          message: 'No image generated: The requested output format is not supported.',
          reasonCode: 'google_image_generation_refused',
        },
        errorType: AgentRuntimeErrorType.ProviderNoImageGenerated,
      },
      isAborted: false,
      isEditingImage: false,
    });

    expect(result).toEqual({
      errorMessage: 'No image generated: The requested output format is not supported.',
      errorType: AsyncTaskErrorType.ServerError,
    });
  });

  it('should keep generic no-image provider responses as server errors', () => {
    const result = categorizeImageGenerationError({
      error: {
        errorType: AgentRuntimeErrorType.ProviderNoImageGenerated,
      },
      isAborted: false,
      isEditingImage: false,
    });

    expect(result).toEqual({
      errorMessage:
        'The provider did not return an image. This may be due to content review. Try a milder prompt or another model.',
      errorType: AsyncTaskErrorType.ServerError,
    });
  });
});

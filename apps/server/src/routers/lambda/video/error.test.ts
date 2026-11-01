import { describe, expect, it } from 'vitest';

import { AsyncTaskErrorType } from '@/types/asyncTask';

import { createVideoTaskSubmitError } from './error';

describe('createVideoTaskSubmitError', () => {
  it('should use task trigger error for generic submit failures', () => {
    const error = createVideoTaskSubmitError(new Error('API timeout'));

    expect(error.name).toBe(AsyncTaskErrorType.TaskTriggerError);
    expect(error.body.detail).toBe('Failed to submit video task: API timeout');
  });

  it('should use provider moderation type for content policy failures', () => {
    const error = createVideoTaskSubmitError(
      new Error('rejected by safety system'),
      'Content policy check failed. Revise your prompt and try again.',
    );

    expect(error.name).toBe(AsyncTaskErrorType.ProviderContentModeration);
    expect(error.body.detail).toBe(
      'Content policy check failed. Revise your prompt and try again.',
    );
  });
});

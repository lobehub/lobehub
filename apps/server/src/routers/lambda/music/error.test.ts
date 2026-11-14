import { describe, expect, it } from 'vitest';

import { AsyncTaskErrorType } from '@/types/asyncTask';

import { createMusicTaskError } from './error';

describe('createMusicTaskError', () => {
  it('keeps credential and moderation errors distinguishable', () => {
    expect(
      createMusicTaskError(
        { error: { message: 'bad key' }, errorType: 'InvalidProviderAPIKey' },
        'submit',
      ),
    ).toMatchObject({
      body: { detail: 'bad key' },
      name: AsyncTaskErrorType.InvalidProviderAPIKey,
    });
    expect(
      createMusicTaskError(
        { error: { error: { message: 'nsfw' } }, errorType: 'ContentModeration' },
        'process',
      ),
    ).toMatchObject({
      body: { detail: 'nsfw' },
      name: AsyncTaskErrorType.ProviderContentModeration,
    });
  });

  it('prefers the content policy message from the business slot', () => {
    expect(createMusicTaskError(new Error('400'), 'submit', 'Blocked by policy')).toMatchObject({
      body: { detail: 'Blocked by policy' },
      name: AsyncTaskErrorType.ProviderContentModeration,
    });
  });

  it('separates submit, processing and timeout failures', () => {
    expect(createMusicTaskError(new Error('boom'), 'submit')).toMatchObject({
      body: { detail: 'Failed to submit music task: boom' },
      name: AsyncTaskErrorType.TaskTriggerError,
    });
    expect(
      createMusicTaskError(
        { error: { message: 'quota' }, errorType: 'InsufficientQuota' },
        'process',
      ),
    ).toMatchObject({
      body: { detail: 'Music generation failed: quota' },
      name: AsyncTaskErrorType.ServerError,
    });
    expect(
      createMusicTaskError(new DOMException('Aborted', 'AbortError'), 'process'),
    ).toMatchObject({
      name: AsyncTaskErrorType.Timeout,
    });
  });
});

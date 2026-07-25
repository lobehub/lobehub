import { AsyncTaskStatus } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveGenerationDisplayState } from './resolveGenerationDisplayState';

describe('resolveGenerationDisplayState', () => {
  it('keeps a pending generation non-terminal when its status request fails', () => {
    expect(
      resolveGenerationDisplayState({
        generationStatus: AsyncTaskStatus.Processing,
        isLoading: false,
        statusRequestError: new Error('Status request failed'),
      }),
    ).toEqual({
      status: AsyncTaskStatus.Processing,
      statusCheckFailed: true,
    });
  });
});

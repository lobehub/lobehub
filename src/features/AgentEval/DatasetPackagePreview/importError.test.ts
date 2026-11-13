import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';

import { datasetImportErrorMessage } from './importError';

describe('dataset import feedback', () => {
  it('keeps actionable package validation and permission messages', () => {
    for (const code of ['BAD_REQUEST', 'FORBIDDEN']) {
      const error = Object.assign(new TRPCClientError('Use a new dataset'), { data: { code } });
      expect(datasetImportErrorMessage(error, 'Try again')).toBe('Use a new dataset');
    }
  });
  it('hides internal database and transport details behind localized feedback', () => {
    const error = Object.assign(new TRPCClientError('internal SQL detail'), {
      data: { code: 'INTERNAL_SERVER_ERROR' },
    });
    expect(datasetImportErrorMessage(error, 'Try again')).toBe('Try again');
    expect(datasetImportErrorMessage(new Error('private storage endpoint'), 'Try again')).toBe(
      'Try again',
    );
  });
});

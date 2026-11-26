import { TRPCClientError } from '@trpc/client';
import { describe, expect, it, vi } from 'vitest';

import { describeEditDirectoryError } from './EditDirectoryModal';

vi.mock('i18next', () => ({ t: (key: string) => key }));

const conflict = (message: string) =>
  new TRPCClientError(message, { result: { error: { data: { code: 'CONFLICT' } } } } as never);

describe('describeEditDirectoryError', () => {
  it('asks the user to wait only when a topic is running', () => {
    const error = conflict('Wait for the running topics to finish before changing this directory');
    Object.assign(error, { data: { code: 'CONFLICT' } });

    expect(describeEditDirectoryError(error)).toBe('settings.editDirectoryBusy');
  });

  it('explains a destination owned by another environment instead of asking to wait', () => {
    const error = conflict('This directory belongs to another environment');
    Object.assign(error, { data: { code: 'CONFLICT' } });

    expect(describeEditDirectoryError(error)).toBe('settings.editDirectoryOtherEnvironment');
  });

  it('keeps the message of any other conflict', () => {
    const error = conflict('The topics in this directory changed; try again');
    Object.assign(error, { data: { code: 'CONFLICT' } });

    expect(describeEditDirectoryError(error)).toBe(
      'The topics in this directory changed; try again',
    );
  });
});

import { describe, expect, it } from 'vitest';

import { classifyFileOpError } from './fileOpErrors';

describe('classifyFileOpError', () => {
  it('recognises a device without a trash', () => {
    expect(
      classifyFileOpError(new Error('This device does not support moving files to the trash')).kind,
    ).toBe('trashUnsupported');
  });

  it('recognises a device client that predates the RPC', () => {
    expect(classifyFileOpError(new Error('Unknown device RPC method: trashLocalFiles')).kind).toBe(
      'unsupported',
    );
  });

  it('recognises an offline device', () => {
    expect(classifyFileOpError(new Error('DEVICE_NOT_FOUND')).kind).toBe('offline');
    expect(classifyFileOpError('Desktop offline').kind).toBe('offline');
  });

  it('passes any other host message through as the reason', () => {
    expect(classifyFileOpError(new Error('EACCES: permission denied'))).toEqual({
      kind: 'reason',
      message: 'EACCES: permission denied',
    });
    expect(classifyFileOpError({ message: 'EEXIST' }).message).toBe('EEXIST');
  });
});

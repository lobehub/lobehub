import { describe, expect, it } from 'vitest';

import { parsePgSearchCleanupOptions } from './options';

describe('parsePgSearchCleanupOptions', () => {
  it('defaults to read-only status', () => {
    expect(parsePgSearchCleanupOptions([])).toEqual({ mode: 'status' });
    expect(parsePgSearchCleanupOptions(['--status'])).toEqual({ mode: 'status' });
  });

  it('requires explicit confirmation before applying cleanup', () => {
    expect(() => parsePgSearchCleanupOptions(['--apply'])).toThrow('--apply requires --yes');
    expect(parsePgSearchCleanupOptions(['--apply', '--yes'])).toEqual({
      mode: 'apply',
      yes: true,
    });
  });

  it('rejects ambiguous or unknown arguments', () => {
    expect(() => parsePgSearchCleanupOptions(['--apply', '--status', '--yes'])).toThrow(
      'Choose exactly one',
    );
    expect(() => parsePgSearchCleanupOptions(['--force'])).toThrow('Unknown argument: --force');
    expect(() => parsePgSearchCleanupOptions(['--status', '--yes'])).toThrow(
      '--status does not accept mutation arguments',
    );
  });
});

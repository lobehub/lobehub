// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { parseSeedSnapshotArgs } from './seedSnapshot';

describe('page collaboration admin snapshot seed CLI', () => {
  it('defaults to a read-only dry-run', () => {
    expect(parseSeedSnapshotArgs(['--document-id', 'document-1'])).toEqual({
      apply: false,
      documentId: 'document-1',
      help: false,
    });
  });

  it('requires an explicit apply flag for writes', () => {
    expect(parseSeedSnapshotArgs(['--apply', '--document-id=document-1'])).toEqual({
      apply: true,
      documentId: 'document-1',
      help: false,
    });
  });

  it('rejects missing document IDs and unknown arguments', () => {
    expect(() => parseSeedSnapshotArgs([])).toThrow('--document-id is required');
    expect(() => parseSeedSnapshotArgs(['--apply'])).toThrow('--document-id is required');
    expect(() => parseSeedSnapshotArgs(['--document-id', 'document-1', '--force'])).toThrow(
      'Unknown argument: --force',
    );
  });
});

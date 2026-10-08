import { describe, expect, it } from 'vitest';

import { findEvidenceFileUrl } from './useAcceptanceBundle';

const bundle = {
  checks: [
    {
      evidence: [{ fileUrl: 'https://s3/current.mp4?sig=new', id: 'current' }],
      timeline: [{ evidence: [{ fileUrl: 'https://s3/older.mp4?sig=new', id: 'older' }] }],
    },
  ],
} as unknown as Parameters<typeof findEvidenceFileUrl>[0];

describe('findEvidenceFileUrl', () => {
  it('finds the re-signed link of an evidence in the check or its history', () => {
    expect(findEvidenceFileUrl(bundle, 'current')).toBe('https://s3/current.mp4?sig=new');
    expect(findEvidenceFileUrl(bundle, 'older')).toBe('https://s3/older.mp4?sig=new');
  });

  it('has nothing to offer for evidence that is gone', () => {
    expect(findEvidenceFileUrl(bundle, 'deleted')).toBeUndefined();
    expect(findEvidenceFileUrl(undefined, 'current')).toBeUndefined();
  });
});

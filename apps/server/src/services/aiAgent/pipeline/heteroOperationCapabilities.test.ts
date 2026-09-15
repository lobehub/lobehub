import { describe, expect, it } from 'vitest';

import { heteroOperationCapabilities } from './heteroOperationCapabilities';

describe('heteroOperationCapabilities', () => {
  it('grants goal management to a /goal run', () => {
    expect(heteroOperationCapabilities('/goal ship the report')).toContain('goal:manage');
  });

  it('keeps goal management out of an ordinary run', () => {
    // Every hetero run used to carry it, so text met during a normal coding run
    // could drive `lh goal create --conversation` and start uncapped work.
    expect(heteroOperationCapabilities('fix the build')).toEqual([
      'hetero:ingest',
      'hetero:finish',
      'hetero:intervention:read',
    ]);
    expect(heteroOperationCapabilities(undefined)).not.toContain('goal:manage');
  });
});

import { describe, expect, it } from 'vitest';

import { buildPagePath } from './navigation';

describe('buildPagePath', () => {
  it.each([
    ['docs_Bp6pBXenfUif7vp5', '/page/Bp6pBXenfUif7vp5'],
    ['page-1', '/page/page-1'],
  ])('builds a canonical Page route for %s', (documentId, expectedPath) => {
    expect(buildPagePath(documentId)).toBe(expectedPath);
  });
});

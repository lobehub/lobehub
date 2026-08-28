import { describe, expect, it } from 'vitest';

import { processPaginationConditions } from './pagination';

describe('processPaginationConditions', () => {
  it('bounds an omitted pagination request to the first 20 rows', () => {
    expect(processPaginationConditions({})).toEqual({ limit: 20, offset: 0 });
  });

  it('uses the default page size when only page is provided', () => {
    expect(processPaginationConditions({ page: 3 })).toEqual({ limit: 20, offset: 40 });
  });

  it('uses the first page when only pageSize is provided', () => {
    expect(processPaginationConditions({ pageSize: 50 })).toEqual({ limit: 50, offset: 0 });
  });

  it('defensively clamps values even when called outside a validated route', () => {
    expect(processPaginationConditions({ page: -1, pageSize: 1000 })).toEqual({
      limit: 100,
      offset: 0,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  buildPageInfo,
  decodeOffsetCursor,
  encodeOffsetCursor,
  paginatedListSchema,
  processPaginationConditions,
  resolvePagination,
} from './pagination';

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

describe('resolvePagination', () => {
  it('prefers the cursor over the deprecated offset and page', () => {
    expect(
      resolvePagination({ cursor: encodeOffsetCursor(40), limit: 10, offset: 5, page: 9 }),
    ).toEqual({ limit: 10, offset: 40 });
  });

  it('falls back to offset, then page, sizing pages by limit or pageSize', () => {
    expect(resolvePagination({ limit: 10, offset: 5, page: 3 })).toEqual({ limit: 10, offset: 5 });
    expect(resolvePagination({ page: 3, pageSize: 10 })).toEqual({ limit: 10, offset: 20 });
  });

  it('uses the endpoint default limit when none is sent', () => {
    expect(resolvePagination({}, 50)).toEqual({ limit: 50, offset: 0 });
  });

  it('rejects a cursor it did not issue as a validation error', () => {
    expect(() => decodeOffsetCursor('garbage')).toThrow(
      expect.objectContaining({ code: 'validation_error', status: 400 }),
    );
    expect(() => decodeOffsetCursor(Buffer.from('o:-1').toString('base64url'))).toThrow();
  });
});

describe('buildPageInfo', () => {
  it('points nextCursor at the row after this page while more remain', () => {
    const info = buildPageInfo({ limit: 2, offset: 0, returned: 2, total: 5 });
    expect(info.hasMore).toBe(true);
    expect(decodeOffsetCursor(info.nextCursor!)).toBe(2);
  });

  it('ends with a null cursor on the last page', () => {
    expect(buildPageInfo({ limit: 2, offset: 4, returned: 1, total: 5 })).toEqual({
      hasMore: false,
      nextCursor: null,
    });
  });

  it('assumes a full page has a successor when the total is unknown', () => {
    expect(buildPageInfo({ limit: 2, offset: 0, returned: 2 }).hasMore).toBe(true);
    expect(buildPageInfo({ limit: 2, offset: 0, returned: 1 }).hasMore).toBe(false);
  });
});

describe('paginatedListSchema', () => {
  it('builds the `items` list contract with an optional total', () => {
    const schema = paginatedListSchema(z.object({ id: z.string() }), { total: true });
    expect(
      schema.parse({ hasMore: false, items: [{ id: 'a' }], nextCursor: null, total: 1 }),
    ).toBeTruthy();
    expect(() => schema.parse({ items: [] })).toThrow();
  });

  it('keeps an existing endpoint key', () => {
    const schema = paginatedListSchema(z.string(), { key: 'agents' });
    expect(schema.parse({ agents: ['x'], hasMore: false, nextCursor: null })).toBeTruthy();
  });
});

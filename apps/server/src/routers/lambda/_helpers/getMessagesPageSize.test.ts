import { describe, expect, it } from 'vitest';

import { getMessagesPageSizeSchema, MAX_GET_MESSAGES_PAGE_SIZE } from './getMessagesPageSize';

describe('getMessagesPageSizeSchema', () => {
  it('keeps an absent page size absent so the model default applies', () => {
    expect(getMessagesPageSizeSchema.parse(undefined)).toBeUndefined();
  });

  it('passes a page size within the cap through', () => {
    expect(getMessagesPageSizeSchema.parse(200)).toBe(200);
  });

  it('clamps an oversized page size instead of rejecting it', () => {
    expect(getMessagesPageSizeSchema.parse(50_000)).toBe(MAX_GET_MESSAGES_PAGE_SIZE);
  });

  it('raises a non-positive page size to one', () => {
    expect(getMessagesPageSizeSchema.parse(0)).toBe(1);
  });
});

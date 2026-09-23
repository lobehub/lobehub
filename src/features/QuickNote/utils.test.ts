import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';

import { formatNoteMeta, getNoteTitle } from './utils';

describe('getNoteTitle', () => {
  it('returns the first non-empty line', () => {
    expect(getNoteTitle('\n\n  \n第一行\n第二行')).toBe('第一行');
    expect(getNoteTitle('')).toBe('');
  });

  it('strips markdown block prefixes from the title line', () => {
    expect(getNoteTitle('# Talk to Ming\n\nbody')).toBe('Talk to Ming');
    expect(getNoteTitle('- first item')).toBe('first item');
    expect(getNoteTitle('> quoted')).toBe('quoted');
    expect(getNoteTitle('1. step')).toBe('step');
  });
});

describe('formatNoteMeta', () => {
  const createdAt = 1_700_000_000_000;
  const time = dayjs(createdAt).format('MM/DD HH:mm');

  it('joins time, collection, and location when all are present', () => {
    expect(formatNoteMeta({ collection: 'Research', createdAt, location: 'Office' })).toBe(
      `${time} · Research · Office`,
    );
  });

  it('omits a missing collection', () => {
    expect(formatNoteMeta({ createdAt, location: 'Office' })).toBe(`${time} · Office`);
  });

  it('omits both collection and location when neither is present', () => {
    expect(formatNoteMeta({ createdAt })).toBe(time);
  });
});

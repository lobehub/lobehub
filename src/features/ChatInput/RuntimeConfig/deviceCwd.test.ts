import { describe, expect, it } from 'vitest';

import { nextRecentCwds, RECENT_CWDS_MAX } from './deviceCwd';

describe('nextRecentCwds', () => {
  it('prepends a new path as most-recent', () => {
    expect(nextRecentCwds('/b', ['/a'])).toEqual(['/b', '/a']);
  });

  it('moves an existing path to the front without duplicating it', () => {
    expect(nextRecentCwds('/a', ['/a', '/b', '/c'])).toEqual(['/a', '/b', '/c']);
    expect(nextRecentCwds('/c', ['/a', '/b', '/c'])).toEqual(['/c', '/a', '/b']);
  });

  it('caps the list length', () => {
    const current = Array.from({ length: RECENT_CWDS_MAX }, (_, i) => `/p${i}`);
    const result = nextRecentCwds('/new', current);
    expect(result).toHaveLength(RECENT_CWDS_MAX);
    expect(result[0]).toBe('/new');
    expect(result).not.toContain(`/p${RECENT_CWDS_MAX - 1}`); // oldest dropped
  });

  it('trims the input and ignores a blank path', () => {
    expect(nextRecentCwds('  /a  ', ['/b'])).toEqual(['/a', '/b']);
    expect(nextRecentCwds('   ', ['/b'])).toEqual(['/b']);
    expect(nextRecentCwds('', ['/b'])).toEqual(['/b']);
  });

  it('defaults to an empty current list', () => {
    expect(nextRecentCwds('/a')).toEqual(['/a']);
  });
});

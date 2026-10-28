import { describe, expect, it } from 'vitest';

import { toFavoritePath } from './path';

describe('toFavoritePath', () => {
  it('keeps a personal path as is', () => {
    expect(toFavoritePath('/agent/agt_a/tpc_b', null)).toBe('/agent/agt_a/tpc_b');
  });

  it('drops the active workspace slug', () => {
    expect(toFavoritePath('/acme/agent/agt_a/tpc_b', 'acme')).toBe('/agent/agt_a/tpc_b');
    expect(toFavoritePath('/acme', 'acme')).toBe('/');
  });

  it('only strips a whole leading segment', () => {
    expect(toFavoritePath('/acme-labs/page/docs_a', 'acme')).toBe('/acme-labs/page/docs_a');
  });

  it('drops a trailing slash', () => {
    expect(toFavoritePath('/acme/projects/', 'acme')).toBe('/projects');
  });
});

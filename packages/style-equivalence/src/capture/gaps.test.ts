import { describe, expect, it } from 'vitest';

import { caseGapsOf } from './gaps';

const containerRule = 'CONTAINER_UNMODELED|@container (width < 300px) { .item { color: red; } }';

describe('caseGapsOf', () => {
  it('reports nothing when both sides carry the same unmodeled rules', () => {
    expect(caseGapsOf({ 'a|A#0|0': [containerRule] }, { 'a|A#0|0': [containerRule] })).toEqual({});
  });

  it('reports each unmodeled kind whose rules differ between the sides', () => {
    expect(
      caseGapsOf(
        { 'a|A#0|0': [containerRule, 'MEDIA_UNMODELED|@media (hover: hover) { .a:hover {} }'] },
        { 'a|A#0|1': ['MEDIA_UNMODELED|@media (hover: hover) { .b:hover {} }'] },
      ),
    ).toEqual({ 'a|A#0': ['CONTAINER_UNMODELED', 'MEDIA_UNMODELED'] });
  });
});

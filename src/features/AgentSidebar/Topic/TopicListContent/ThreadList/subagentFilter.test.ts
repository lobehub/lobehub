import { describe, expect, it } from 'vitest';

import { collectSubagentIds, filterThreadsBySubagent } from './subagentFilter';

const threads = [
  { id: 't1', subagentId: 'sub_a' },
  { id: 't2', subagentId: null },
  { id: 't3', subagentId: 'sub_b' },
  { id: 't4' },
  { id: 't5', subagentId: 'sub_a' },
];

describe('filterThreadsBySubagent', () => {
  it('keeps every thread for "all"', () => {
    expect(filterThreadsBySubagent(threads, 'all').map((t) => t.id)).toEqual([
      't1',
      't2',
      't3',
      't4',
      't5',
    ]);
  });

  it('keeps main-agent and legacy threads for "main"', () => {
    expect(filterThreadsBySubagent(threads, 'main').map((t) => t.id)).toEqual(['t2', 't4']);
  });

  it('keeps only the selected preset threads', () => {
    expect(filterThreadsBySubagent(threads, 'sub_a').map((t) => t.id)).toEqual(['t1', 't5']);
  });
});

describe('collectSubagentIds', () => {
  it('lists distinct preset ids in first-seen order', () => {
    expect(collectSubagentIds(threads)).toEqual(['sub_a', 'sub_b']);
  });
});

import { describe, expect, it } from 'vitest';

import { sortProjects } from './sortProjects';

const projects = [
  { createdAt: '2026-01-02', id: 'a', updatedAt: '2026-03-01' },
  { createdAt: '2026-01-03', id: 'b', updatedAt: '2026-02-01' },
  { createdAt: '2026-01-01', id: 'c', updatedAt: '2026-04-01' },
];
const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe('sortProjects', () => {
  it('follows sort_order in manual mode, unplaced projects first and newest first', () => {
    const placed = [
      { ...projects[0], sortOrder: 1 },
      { ...projects[1], sortOrder: 0 },
      { ...projects[2], sortOrder: null },
    ];
    expect(ids(sortProjects(placed, 'manual'))).toEqual(['c', 'b', 'a']);
    expect(ids(sortProjects(projects, 'manual'))).toEqual(['c', 'a', 'b']);
  });

  it('puts the newest created project first', () => {
    expect(ids(sortProjects(projects, 'createdAt'))).toEqual(['b', 'a', 'c']);
  });

  it('puts the most recently updated project first', () => {
    expect(ids(sortProjects(projects, 'updatedAt'))).toEqual(['c', 'a', 'b']);
  });
});

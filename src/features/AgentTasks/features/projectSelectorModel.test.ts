import { describe, expect, it } from 'vitest';

import type { ProjectListItem } from '@/store/project';

import { filterProjectsByName, resolveTaskProjectDisplay } from './projectSelectorModel';

const projects = [
  { id: 'p1', name: 'Apollo' },
  { id: 'p2', name: 'Website Redesign' },
] as ProjectListItem[];

describe('filterProjectsByName', () => {
  it('keeps everything for a blank search', () => {
    expect(filterProjectsByName(projects, '   ')).toEqual(projects);
  });

  it('matches any part of the name, ignoring case and outer spaces', () => {
    expect(filterProjectsByName(projects, ' REDES ')).toEqual([projects[1]]);
    expect(filterProjectsByName(projects, 'nope')).toEqual([]);
  });
});

describe('resolveTaskProjectDisplay', () => {
  it('has no project without an id, whatever the list says', () => {
    expect(resolveTaskProjectDisplay(null, projects)).toEqual({ kind: 'none' });
    expect(resolveTaskProjectDisplay(undefined, undefined)).toEqual({ kind: 'none' });
  });

  it('waits for the list before judging an id', () => {
    expect(resolveTaskProjectDisplay('p1', undefined)).toEqual({ kind: 'pending' });
  });

  it('names a project only from its own row', () => {
    expect(resolveTaskProjectDisplay('p2', projects)).toEqual({
      kind: 'project',
      project: projects[1],
    });
    expect(resolveTaskProjectDisplay('gone', projects)).toEqual({ kind: 'unavailable' });
  });
});

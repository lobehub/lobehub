import { describe, expect, it } from 'vitest';

import type { ProjectDetail, ProjectListItem } from './projection';
import { initialProjectState, projectByRefSelector } from './store';

const row = (id: string, slug: string, name = id) => ({ id, name, slug }) as ProjectListItem;

const state = (detail: Record<string, ProjectDetail> = {}) => ({
  ...initialProjectState,
  projectDetailMap: detail,
  projectListMap: { all: [row('prj_a', 'alpha'), row('prj_b', 'beta')] },
});

describe('projectByRefSelector', () => {
  it('resolves a route param from the project list by id or slug', () => {
    expect(projectByRefSelector('prj_b')(state())?.slug).toBe('beta');
    expect(projectByRefSelector('alpha')(state())?.id).toBe('prj_a');
  });

  it('prefers the loaded project page over the list row', () => {
    const detail = { project: row('prj_a', 'alpha', 'Fresh') } as ProjectDetail;

    expect(projectByRefSelector('alpha')(state({ alpha: detail }))?.name).toBe('Fresh');
  });

  it('is undefined for a param it cannot resolve', () => {
    expect(projectByRefSelector('gamma')(state())).toBeUndefined();
    expect(projectByRefSelector(undefined)(state())).toBeUndefined();
    expect(projectByRefSelector('alpha')(initialProjectState)).toBeUndefined();
  });
});

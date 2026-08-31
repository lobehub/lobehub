import { describe, expect, it } from 'vitest';

import { projectReducer } from './reducer';
import type { ProjectDetail, ProjectListItem, ProjectStoreState } from './store';

const project = (name: string) => ({ id: 'project-1', name, slug: 'launch' }) as ProjectListItem;
const state = (): ProjectStoreState => ({
  projectDetails: { personal: { launch: { project: project('Old') } as ProjectDetail } },
  projectLists: { personal: [project('Old')] },
  projectOptimisticPatches: {},
});

describe('projectReducer', () => {
  it('keeps optimistic patches transient and emits no persistence effect', () => {
    const transition = projectReducer(state(), {
      id: 'project-1',
      patch: { name: 'Draft' },
      scope: 'personal',
      type: 'optimisticUpdate',
    });

    expect(transition.state.projectOptimisticPatches.personal['project-1']).toEqual({
      name: 'Draft',
    });
    expect(transition.effects).toEqual([]);
  });

  it('fans a confirmed update out to related list and detail projections only', () => {
    const unrelated = [project('Other')];
    const current = state();
    current.projectLists.workspace = unrelated;
    const transition = projectReducer(current, {
      id: 'project-1',
      project: project('Renamed'),
      scope: 'personal',
      type: 'commitUpdate',
    });

    expect(transition.state.projectLists.personal[0].name).toBe('Renamed');
    expect(transition.state.projectDetails.personal.launch.project.name).toBe('Renamed');
    expect(transition.state.projectLists.workspace).toBe(unrelated);
    expect(transition.effects.map((effect) => effect.projection.kind)).toEqual(['list', 'detail']);
  });

  it('does not let storage hydration overwrite an existing server projection', () => {
    const current = state();
    const transition = projectReducer(current, {
      data: [project('Cached')],
      scope: 'personal',
      type: 'hydrateList',
    });

    expect(transition.state.projectLists).toBe(current.projectLists);
    expect(transition.effects).toEqual([]);
  });
});

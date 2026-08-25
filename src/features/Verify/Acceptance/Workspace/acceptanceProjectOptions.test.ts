import { describe, expect, it } from 'vitest';

import { buildAcceptanceProjectMenuState } from './acceptanceProjectOptions';

const projects = [
  { id: 'p1', name: 'Recycle bin' },
  { id: 'p2', name: 'Acceptance' },
];

describe('buildAcceptanceProjectMenuState', () => {
  it('reports a failed fetch as an error, never as "no projects"', () => {
    expect(buildAcceptanceProjectMenuState({ error: new Error('offline'), projects: [] })).toEqual({
      type: 'error',
    });
  });

  it('waits while the projects have not arrived yet', () => {
    expect(buildAcceptanceProjectMenuState({})).toEqual({ type: 'loading' });
  });

  it('distinguishes an empty project list from a pending one', () => {
    expect(buildAcceptanceProjectMenuState({ projects: [] })).toEqual({ type: 'empty' });
  });

  it('marks the project the acceptance is already filed under', () => {
    expect(buildAcceptanceProjectMenuState({ currentProjectId: 'p2', projects })).toEqual({
      options: [
        { id: 'p1', name: 'Recycle bin', selected: false },
        { id: 'p2', name: 'Acceptance', selected: true },
      ],
      type: 'options',
    });
  });

  it('selects nothing for an ungrouped acceptance', () => {
    const state = buildAcceptanceProjectMenuState({ currentProjectId: null, projects });

    expect(state.type).toBe('options');
    expect(state.type === 'options' && state.options.every(({ selected }) => !selected)).toBe(true);
  });
});

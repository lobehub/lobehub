import { describe, expect, it } from 'vitest';

import type { ProjectListItem } from '@/store/project';

import { resolveProjectListState } from './projectListState';

const project = { id: 'prj_1' } as ProjectListItem;
const idle = { error: undefined, isHydrated: true, isValidating: false };

describe('resolveProjectListState', () => {
  it('shows the empty action, not a skeleton, while a confirmed-empty list revalidates', () => {
    expect(resolveProjectListState({ ...idle, isValidating: true, projects: [] })).toBe('empty');
  });

  it('keeps rendering rows while they revalidate', () => {
    expect(resolveProjectListState({ ...idle, isValidating: true, projects: [project] })).toBe(
      'ready',
    );
  });

  it('shows the skeleton only until the list first loads', () => {
    expect(resolveProjectListState({ ...idle, isHydrated: false, projects: undefined })).toBe(
      'loading',
    );
    expect(resolveProjectListState({ ...idle, isValidating: true, projects: undefined })).toBe(
      'loading',
    );
  });

  it('surfaces a failed fetch when no rows are on screen', () => {
    const error = new Error('offline');

    expect(resolveProjectListState({ ...idle, error, projects: undefined })).toBe('error');
    expect(resolveProjectListState({ ...idle, error, projects: [] })).toBe('error');
    expect(resolveProjectListState({ ...idle, error, projects: [project] })).toBe('ready');
  });
});

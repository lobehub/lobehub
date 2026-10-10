import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';

import {
  canEmptyTrashView,
  fromProjectFilterValue,
  isProjectRefusedError,
  isScopeChangedError,
  PROJECT_FILTER_ALL,
  PROJECT_FILTER_NONE,
  resolveProjectAvailability,
  toProjectFilterValue,
} from './projectFilterState';

const trpcError = (code: string) =>
  new TRPCClientError('refused', { result: { error: { data: { code } } } } as any);

describe('trash project filter state', () => {
  it('round-trips all, no project and a project through the picker value', () => {
    for (const projectId of [undefined, null, 'proj_a']) {
      expect(fromProjectFilterValue(toProjectFilterValue(projectId))).toBe(projectId);
    }
    expect(toProjectFilterValue(undefined)).toBe(PROJECT_FILTER_ALL);
    expect(toProjectFilterValue(null)).toBe(PROJECT_FILTER_NONE);
  });

  it('never makes All or No project depend on the project list', () => {
    for (const projectId of [undefined, null]) {
      for (const projects of [undefined, []]) {
        expect(resolveProjectAvailability({ projectId, projects, refused: true })).toBe(
          'available',
        );
      }
    }
  });

  it('keeps a project unconfirmed while the list loads and unavailable once it is gone', () => {
    const projects = [{ id: 'proj_a' }, { id: 'proj_b' }];
    expect(resolveProjectAvailability({ projectId: 'proj_a', projects: undefined })).toBe(
      'unknown',
    );
    expect(resolveProjectAvailability({ projectId: 'proj_a', projects })).toBe('available');
    // Deleted or access revoked: the live list no longer holds it.
    expect(resolveProjectAvailability({ projectId: 'proj_c', projects })).toBe('unavailable');
    expect(resolveProjectAvailability({ projectId: 'proj_a', projects: [] })).toBe('unavailable');
    // The server refused it before the list caught up.
    expect(resolveProjectAvailability({ projectId: 'proj_a', projects, refused: true })).toBe(
      'unavailable',
    );
  });

  it('offers "empty" only on a settled, confirmed view', () => {
    const settled = {
      availability: 'available' as const,
      filterCount: 3,
      hasError: false,
      itemCount: 3,
    };
    expect(canEmptyTrashView(settled)).toBe(true);
    expect(canEmptyTrashView({ ...settled, availability: 'unknown' })).toBe(false);
    expect(canEmptyTrashView({ ...settled, availability: 'unavailable' })).toBe(false);
    expect(canEmptyTrashView({ ...settled, filterCount: undefined })).toBe(false);
    expect(canEmptyTrashView({ ...settled, filterCount: 0 })).toBe(false);
    expect(canEmptyTrashView({ ...settled, hasError: true })).toBe(false);
    expect(canEmptyTrashView({ ...settled, itemCount: 0 })).toBe(false);
  });

  it('recognizes the server refusals by their TRPC code', () => {
    expect(isProjectRefusedError(trpcError('NOT_FOUND'))).toBe(true);
    expect(isProjectRefusedError(trpcError('INTERNAL_SERVER_ERROR'))).toBe(false);
    expect(isProjectRefusedError(undefined)).toBe(false);
    expect(isScopeChangedError(trpcError('PRECONDITION_FAILED'))).toBe(true);
    expect(isScopeChangedError(trpcError('NOT_FOUND'))).toBe(false);
  });
});

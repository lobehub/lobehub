import { describe, expect, it } from 'vitest';

import {
  getDeletedByLabel,
  getEmptyTrashActionState,
  getPurgeFeedback,
  getRestoreFeedback,
  toggleTrashSelection,
} from './trashListUtils';

describe('trashListUtils', () => {
  it('blocks emptying until the server count succeeds', () => {
    expect(
      getEmptyTrashActionState({
        countByType: {},
        countError: new Error('count failed'),
        hasCountData: false,
      }),
    ).toEqual({ count: 0, ready: false, total: 0 });

    expect(
      getEmptyTrashActionState({
        activeType: 'document',
        countByType: { document: 7, file: 2 },
        countError: undefined,
        hasCountData: true,
      }),
    ).toEqual({ count: 7, ready: true, total: 9 });
  });

  it('reports partial restore and purge outcomes with explicit counts', () => {
    expect(getRestoreFeedback({ failed: [{ code: 'parentTrashed' }], restored: [{}] })).toEqual({
      key: 'trash.restore.partial',
      level: 'warning',
      params: { failed: 1, restored: 1 },
    });
    expect(getPurgeFeedback({ failed: [{}], purged: 2 })).toEqual({
      key: 'trash.purge.partial',
      level: 'warning',
      params: { failed: 1, purged: 2 },
    });
  });

  it('resolves workspace actors without exposing raw user ids', () => {
    const item = { deletedByUserId: 'actor', workspaceId: 'workspace' };
    expect(
      getDeletedByLabel(item, [{ user: { fullName: 'Alex' }, userId: 'actor' }], {
        formerMember: 'Former member',
        you: 'You',
      }),
    ).toBe('Alex');
    expect(getDeletedByLabel(item, [], { formerMember: 'Former member', you: 'You' })).toBe(
      'Former member',
    );
  });

  it('keeps selection unique and reversible', () => {
    expect(toggleTrashSelection(['trash-1'], 'trash-1', true)).toEqual(['trash-1']);
    expect(toggleTrashSelection(['trash-1'], 'trash-2', true)).toEqual(['trash-1', 'trash-2']);
    expect(toggleTrashSelection(['trash-1', 'trash-2'], 'trash-1', false)).toEqual(['trash-2']);
  });
});

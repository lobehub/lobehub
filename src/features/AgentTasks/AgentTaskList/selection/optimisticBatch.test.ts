import { describe, expect, it } from 'vitest';

import { confirmedTaskPatches, optimisticTaskPatch } from './optimisticBatch';

const task = { archivedAt: null, id: 'a', priority: 0, status: 'backlog' } as any;
const hidesArchived = { includeArchived: false };
const showsArchived = { includeArchived: true };

describe('optimisticTaskPatch', () => {
  it('moves the status', () => {
    expect(optimisticTaskPatch({ kind: 'status', status: 'completed' })(task, {})).toEqual({
      ...task,
      status: 'completed',
    });
  });

  it('sets only the fields the patch names, null included', () => {
    const next = optimisticTaskPatch({
      kind: 'update',
      patch: { assigneeUserId: null, priority: 2 },
    })({ ...task, assigneeAgentId: 'agt', assigneeUserId: 'u1' }, {});
    expect(next).toMatchObject({ assigneeAgentId: 'agt', assigneeUserId: null, priority: 2 });
  });

  it('takes deleted rows out of every collection', () => {
    expect(optimisticTaskPatch({ kind: 'delete' })(task, showsArchived)).toBeUndefined();
  });

  it('archives out of lists that hide archived rows, and marks them where they show', () => {
    const archive = optimisticTaskPatch({ archived: true, kind: 'archive' });
    expect(archive(task, hidesArchived)).toBeUndefined();
    expect(archive(task, {})).toBeUndefined();
    expect(archive(task, showsArchived)?.archivedAt).toBeInstanceOf(Date);
    expect(
      optimisticTaskPatch({ archived: false, kind: 'archive' })(
        { ...task, archivedAt: new Date() },
        showsArchived,
      )?.archivedAt,
    ).toBeNull();
  });
});

describe('confirmedTaskPatches', () => {
  const patch = optimisticTaskPatch({ kind: 'status', status: 'completed' });

  it('keeps only the updated ids', () => {
    expect([...confirmedTaskPatches(patch, ['a', 'c']).keys()]).toEqual(['a', 'c']);
  });

  it('confirms a returned row with the server values', () => {
    const completedAt = new Date('2026-11-03T00:00:00Z');
    const keep = confirmedTaskPatches(patch, ['a'], [{ completedAt, id: 'a' } as any]);
    expect(keep.get('a')!(task, {})).toMatchObject({ completedAt, status: 'completed' });
  });

  it('keeps a removal a removal', () => {
    const remove = optimisticTaskPatch({ kind: 'delete' });
    const keep = confirmedTaskPatches(remove, ['a'], [{ id: 'a' } as any]);
    expect(keep.get('a')!(task, {})).toBeUndefined();
  });
});

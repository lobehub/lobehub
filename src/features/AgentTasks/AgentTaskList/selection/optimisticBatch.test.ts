import { describe, expect, it } from 'vitest';

import { confirmedTaskPatches, optimisticTaskPatch } from './optimisticBatch';

const task = { archivedAt: null, id: 'a', priority: 0, status: 'backlog' } as any;
const hidesArchived = { includeArchived: false };
const showsArchived = { includeArchived: true };

describe('optimisticTaskPatch', () => {
  it('moves the status and stamps the close time on completed / canceled', () => {
    const completed = optimisticTaskPatch({ kind: 'status', status: 'completed' })(task, {});
    expect(completed).toMatchObject({ status: 'completed' });
    expect(completed?.completedAt).toBeInstanceOf(Date);
    expect(completed?.updatedAt).toBe(completed?.completedAt);

    const paused = optimisticTaskPatch({ kind: 'status', status: 'paused' })(task, {});
    expect(paused).toMatchObject({ status: 'paused' });
    expect(paused).not.toHaveProperty('completedAt');
    expect(paused?.updatedAt).toBeInstanceOf(Date);
  });

  it('takes a reassigned row out of a collection scoped to its old assignee', () => {
    const toBeta = optimisticTaskPatch({ kind: 'update', patch: { assigneeAgentId: 'beta' } });
    const row = { ...task, assigneeAgentId: 'alpha', assigneeUserId: 'me' };
    expect(toBeta(row, { agentId: 'alpha' })).toBeUndefined();
    expect(toBeta(row, { agentId: 'beta' })).toMatchObject({ assigneeAgentId: 'beta' });
    expect(toBeta(row, {})).toMatchObject({ assigneeAgentId: 'beta' });

    const toOther = optimisticTaskPatch({ kind: 'update', patch: { assigneeUserId: 'other' } });
    expect(toOther(row, { scope: 'assigned' })).toBeUndefined();
    expect(toOther(row, { scope: 'created' })).toMatchObject({ assigneeUserId: 'other' });
    // Priority-only edits never move a row out of a scope.
    const priority = optimisticTaskPatch({ kind: 'update', patch: { priority: 3 } });
    expect(priority(row, { agentId: 'alpha', scope: 'assigned' })).toMatchObject({ priority: 3 });
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
    // Unknown collection (persisted, unloaded): left as stored.
    expect(archive(task, {})).toBe(task);
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

import { describe, expect, it } from 'vitest';

import { getArchiveErrorKey } from './archiveErrorKey';

describe('getArchiveErrorKey', () => {
  it('explains a task held by an open goal', () => {
    expect(getArchiveErrorKey({ data: { code: 'CONFLICT' } })).toBe(
      'taskList.contextMenu.archiveGoalBlocked',
    );
  });

  it('falls back to the generic failure', () => {
    expect(getArchiveErrorKey({ data: { code: 'BAD_REQUEST' } })).toBe(
      'taskList.contextMenu.archiveFailed',
    );
    expect(getArchiveErrorKey(new Error('offline'))).toBe('taskList.contextMenu.archiveFailed');
    expect(getArchiveErrorKey(null)).toBe('taskList.contextMenu.archiveFailed');
  });
});

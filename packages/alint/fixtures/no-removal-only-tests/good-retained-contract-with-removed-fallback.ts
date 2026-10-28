// Fixture: a no-throw contract and a surviving call's arguments, each with one absence line.
import { afterEach, expect, it, vi } from 'vitest';

import { installPreviewBridge } from './bridge';
import { syncSidebarGroups } from './sidebarGroups';

afterEach(() => {
  document.head.innerHTML = '';
  vi.unstubAllGlobals();
});

// The HTTP runtime fallback was removed; insecure (http) contexts still have to boot.
it('initializes without secure-context UUID support or an HTTP runtime fallback', () => {
  vi.stubGlobal('crypto', { randomUUID: undefined });
  expect(() => installPreviewBridge()).not.toThrow();
  expect(document.querySelector('script')).toBeNull();
});

// The panel used to read the SWR-persisted `task:sidebarGroups` key.
it('syncs the agent board without finished columns, ignoring the visibility chip', async () => {
  const groupList = vi.fn().mockResolvedValue([]);
  const { keys } = await syncSidebarGroups('agt_1', { groupList, visibilityChip: 'private' });

  expect(keys).not.toContain('task:sidebarGroups');
  expect(groupList).toHaveBeenCalledWith({
    assigneeAgentId: 'agt_1',
    excludeStatuses: ['canceled', 'completed'],
    visibility: undefined,
  });
});

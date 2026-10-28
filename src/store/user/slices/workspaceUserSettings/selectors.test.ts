import { describe, expect, it } from 'vitest';

import type { UserStore } from '@/store/user';

import { workspaceUserSettingsSelectors } from './selectors';

const state = (workspaceId: string | null, topicOnlyMine?: boolean) =>
  ({
    workspaceUserPreference: { topicOnlyMine },
    workspaceUserPreferenceWorkspaceId: workspaceId,
  }) as unknown as UserStore;

describe('workspaceUserSettingsSelectors.topicOnlyMine', () => {
  it('reads the filter for the workspace the bucket was loaded for', () => {
    expect(workspaceUserSettingsSelectors.topicOnlyMine('ws-1')(state('ws-1', true))).toBe(true);
    expect(workspaceUserSettingsSelectors.topicOnlyMine('ws-1')(state('ws-1', false))).toBe(false);
  });

  /** @example Switching from a workspace back to personal mode keeps the old bucket in the store. */
  it('ignores a bucket left over from another workspace or in personal mode', () => {
    expect(workspaceUserSettingsSelectors.topicOnlyMine(null)(state('ws-1', true))).toBe(false);
    expect(workspaceUserSettingsSelectors.topicOnlyMine('ws-2')(state('ws-1', true))).toBe(false);
  });
});

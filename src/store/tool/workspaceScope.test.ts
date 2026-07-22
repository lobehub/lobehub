import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';

import { composioStoreSelectors } from './slices/composioStore/selectors';
import { ComposioServerStatus } from './slices/composioStore/types';
import { connectorSelectors } from './slices/connector/selectors';
import { lobehubSkillStoreSelectors } from './slices/lobehubSkillStore/selectors';
import { LobehubSkillStatus } from './slices/lobehubSkillStore/types';
import { isBucketInScope, markBucketScope, PERSONAL_SCOPE_KEY } from './workspaceScope';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: vi.fn(() => null),
  useActiveWorkspaceId: vi.fn(() => null),
}));

const inWorkspace = (id: string | null) => vi.mocked(getActiveWorkspaceId).mockReturnValue(id);

beforeEach(() => {
  inWorkspace(null);
});

describe('tool bucket scope keys', () => {
  it('stamps the active workspace and treats personal as its own scope', () => {
    inWorkspace(null);
    const personal = markBucketScope({}, 'connectors');
    expect(personal.connectors).toBe(PERSONAL_SCOPE_KEY);

    inWorkspace('ws-1');
    const workspace = markBucketScope({}, 'connectors');
    expect(workspace.connectors).toBe('ws-1');

    // The personal stamp must not read as in-scope inside a workspace —
    // that confusion is the whole bug this guards against.
    expect(isBucketInScope({ toolBucketScopes: personal }, 'connectors')).toBe(false);
    expect(isBucketInScope({ toolBucketScopes: workspace }, 'connectors')).toBe(true);
  });

  it('reads an unstamped bucket as personal — usable there, hidden inside a workspace', () => {
    inWorkspace(null);
    expect(isBucketInScope({ toolBucketScopes: {} }, 'composioServers')).toBe(true);

    inWorkspace('ws-1');
    expect(isBucketInScope({ toolBucketScopes: {} }, 'composioServers')).toBe(false);
  });
});

/**
 * The regression that motivated all of this: the tool store is a module-level
 * singleton that survives the workspace-switch remount, and correctness used to
 * depend on someone remembering to register a reset hook. These cases simulate
 * exactly that omission — data fetched in personal scope, still sitting in the
 * store, while the user is now inside a workspace — and assert the selectors
 * refuse it instead of rendering another scope's integrations.
 */
describe('selectors reject data fetched under a different workspace', () => {
  const personalScopes = () => {
    inWorkspace(null);
    return {
      agentSkills: markBucketScope({}, 'agentSkills').agentSkills,
      composioServers: markBucketScope({}, 'composioServers').composioServers,
      connectors: markBucketScope({}, 'connectors').connectors,
      lobehubSkillServers: markBucketScope({}, 'lobehubSkillServers').lobehubSkillServers,
    };
  };

  it('hides personal Composio connections once inside a workspace', () => {
    const state = {
      composioServers: [
        { identifier: 'gmail', label: 'Gmail', status: ComposioServerStatus.ACTIVE, tools: [] },
      ],
      toolBucketScopes: personalScopes(),
    } as any;

    inWorkspace(null);
    expect(composioStoreSelectors.getServers(state)).toHaveLength(1);
    expect(composioStoreSelectors.isComposioServer('gmail')(state)).toBe(true);

    inWorkspace('ws-1');
    expect(composioStoreSelectors.getServers(state)).toEqual([]);
    expect(composioStoreSelectors.getConnectedServers(state)).toEqual([]);
    expect(composioStoreSelectors.isComposioServer('gmail')(state)).toBe(false);
    expect(composioStoreSelectors.getServerByIdentifier('gmail')(state)).toBeUndefined();
  });

  it('hides personal LobeHub Skill connections once inside a workspace', () => {
    const state = {
      lobehubSkillServers: [
        { identifier: 'github', name: 'GitHub', status: LobehubSkillStatus.CONNECTED },
      ],
      toolBucketScopes: personalScopes(),
    } as any;

    inWorkspace(null);
    expect(lobehubSkillStoreSelectors.getServers(state)).toHaveLength(1);

    inWorkspace('ws-1');
    expect(lobehubSkillStoreSelectors.getServers(state)).toEqual([]);
    expect(lobehubSkillStoreSelectors.getConnectedServers(state)).toEqual([]);
    expect(lobehubSkillStoreSelectors.metaList(state)).toEqual([]);
    expect(lobehubSkillStoreSelectors.isLobehubSkillServer('github')(state)).toBe(false);
  });

  it('hides personal connectors once inside a workspace', () => {
    const state = {
      agentBoundConnectors: [],
      agentConnectors: {},
      connectorSyncing: {},
      connectors: [
        { id: 'c1', identifier: 'gmail', sourceType: 'custom', status: 'connected', tools: [] },
      ],
      toolBucketScopes: personalScopes(),
    } as any;

    inWorkspace(null);
    expect(connectorSelectors.connectorList(state)).toHaveLength(1);

    inWorkspace('ws-1');
    expect(connectorSelectors.connectorList(state)).toEqual([]);
    expect(connectorSelectors.customConnectors(state)).toEqual([]);
    expect(connectorSelectors.connectorById('c1')(state)).toBeUndefined();
  });

  it('returns a stable empty reference so out-of-scope reads do not re-render', () => {
    const state = { composioServers: [{ identifier: 'gmail' }], toolBucketScopes: {} } as any;
    inWorkspace('ws-1');
    expect(composioStoreSelectors.getServers(state)).toBe(composioStoreSelectors.getServers(state));
  });
});

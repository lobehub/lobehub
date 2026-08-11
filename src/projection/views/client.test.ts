import type {
  AgentDirectoryIndex,
  AgentProjection,
  ProjectionHydrationRequest,
} from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyProjectionScope } from '../core/initialState';
import { agentDirectoryViewContract } from '../modules/agent/contracts';
import { registerProjectionPersistence } from '../registry';
import { useProjectionStore } from '../store';
import { ensureProjectionView } from './client';

vi.mock('@/libs/swr/useCacheScope', () => ({
  isAnonymousScope: (scope: string) => scope.startsWith('anon:'),
  isScopeTrusted: () => true,
}));

const SCOPE = 'user-1:personal';
const directoryIndex: AgentDirectoryIndex = {
  key: 'agent.directory',
  observedAt: 10,
  refs: [
    { id: 'agent-1', kind: 'agent' },
    { id: 'agent-2', kind: 'agent' },
  ],
  signature: {},
  source: 'network',
};

const agentRecord = (id: string): AgentProjection => ({
  fragments: {
    access: { data: {}, observedAt: 10, source: 'network' },
    identity: { data: { title: id }, observedAt: 10, source: 'network' },
    profile: { data: {}, observedAt: 10, source: 'network' },
    runtime: { data: {}, observedAt: 10, source: 'network' },
  },
  id,
  kind: 'agent',
});

describe('ensureProjectionView', () => {
  afterEach(() => {
    useProjectionStore.setState({ scopes: {} });
    vi.restoreAllMocks();
  });

  it('loads an index first, follows its refs, and never hydrates unrelated entities', async () => {
    useProjectionStore.setState({
      scopes: { [SCOPE]: createEmptyProjectionScope('ready') },
    });
    const hydrate = vi.fn(async (_scope: string, request: ProjectionHydrationRequest) => {
      if (request.indexes?.includes('agent.directory')) {
        return { indexes: [directoryIndex], records: [], snapshots: [] };
      }

      const ids = request.records?.flatMap((record) => record.ids) ?? [];
      return {
        indexes: [],
        records: ids.map(agentRecord),
        snapshots: [],
      };
    });
    const unregister = registerProjectionPersistence({
      clearScope: vi.fn(),
      commit: vi.fn(),
      hydrate,
    });

    try {
      await ensureProjectionView(SCOPE, agentDirectoryViewContract, {});
    } finally {
      unregister();
    }

    expect(hydrate).toHaveBeenCalledTimes(2);
    expect(hydrate.mock.calls[0]).toEqual([
      SCOPE,
      { indexes: ['agent.directory'], records: [], snapshots: undefined },
    ]);
    expect(hydrate.mock.calls[1][0]).toBe(SCOPE);
    expect(hydrate.mock.calls[1][1]).toEqual({
      indexes: undefined,
      records: [
        {
          fragments: ['access', 'identity', 'profile', 'runtime'],
          ids: ['agent-1', 'agent-2'],
          kind: 'agent',
        },
      ],
      snapshots: undefined,
    });
    expect(Object.keys(useProjectionStore.getState().scopes[SCOPE].records.agent)).toEqual([
      'agent-1',
      'agent-2',
    ]);
    expect(useProjectionStore.getState().scopes[SCOPE].records.topic).toEqual({});
  });
});

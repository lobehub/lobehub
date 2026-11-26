// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorToolModel } from '@/database/models/connectorTool';
import type * as RefreshModule from '@/server/services/connector/refresh';
import { scheduleStaleConnectorToolsRefresh } from '@/server/services/connector/refresh';

import { scheduleConnectorRefresh } from './connectors';

vi.mock('@/server/services/connector/refresh', async (importOriginal) => ({
  ...(await importOriginal<typeof RefreshModule>()),
  scheduleStaleConnectorToolsRefresh: vi.fn(),
}));

const sharedRow = { id: 'shared', identifier: 'team-linear', userId: 'mate', workspaceId: 'ws-1' };
const personalRow = { id: 'personal', identifier: 'my-gmail', userId: 'user-1', workspaceId: null };

const depsFor = (workspaceId: string | undefined, personalModel: object) => {
  const connectorModel = {
    // `ConnectorModel.forRow`: a personal row of the caller in a workspace run
    forRow: vi.fn((row: { workspaceId: string | null }) =>
      workspaceId && row.workspaceId === null ? personalModel : connectorModel,
    ),
  };
  return {
    connectorModel,
    connectorToolModel: { scope: 'run' },
    db: {},
    userId: 'user-1',
    workspaceId,
  } as any;
};

const schedule = (deps: any, connectors: object[]) =>
  scheduleConnectorRefresh(deps, {
    connectorGateKeeper: undefined,
    connectorsMcp: connectors as any,
    connectorTools: [],
    discoverableConnectorsMcp: [],
    discoverableConnectorTools: [],
  });

describe('scheduleConnectorRefresh', () => {
  beforeEach(() => {
    vi.mocked(scheduleStaleConnectorToolsRefresh).mockClear();
  });

  /**
   * @example
   * expect(refreshedRows).toContain(ownersPersonalConnector);
   */
  it("refreshes a private agent's personal connector through the personal scope", () => {
    // ROOT CAUSE:
    //
    // A private agent's workspace run resolves its owner's personal HTTP connector, but the
    // stale-tool refresh dropped every personal row because the run's workspace-scoped models
    // cannot write it. A connector used only this way never refreshed its tool list.
    const personalModel = { scope: 'personal' };
    const deps = depsFor('ws-1', personalModel);

    schedule(deps, [sharedRow, personalRow]);

    const calls = vi.mocked(scheduleStaleConnectorToolsRefresh).mock.calls;
    expect(calls).toHaveLength(2);
    const [inRunScope, , runContext] = calls[0];
    expect(inRunScope.map((c) => c.id)).toEqual(['shared']);
    expect(runContext).toMatchObject({
      connectorModel: deps.connectorModel,
      connectorToolModel: deps.connectorToolModel,
      userId: 'user-1',
    });
    const [personal, , personalContext] = calls[1];
    expect(personal.map((c) => c.id)).toEqual(['personal']);
    expect(personalContext.connectorModel).toBe(personalModel);
    expect(personalContext.connectorToolModel).toBeInstanceOf(ConnectorToolModel);
    expect(personalContext).toMatchObject({ userId: 'user-1' });
  });

  it('refreshes every row with the run context outside a workspace', () => {
    const deps = depsFor(undefined, { scope: 'personal' });

    schedule(deps, [personalRow]);

    const calls = vi.mocked(scheduleStaleConnectorToolsRefresh).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0].map((c) => c.id)).toEqual(['personal']);
    expect(calls[0][2]).toMatchObject({ connectorModel: deps.connectorModel });
    expect(deps.connectorModel.forRow).not.toHaveBeenCalled();
  });
});

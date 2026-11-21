import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getAllRunConnectors,
  getRunConnectors,
  refreshRunConnectors,
  resetRunConnectors,
} from './runConnectors';

const { listForRun, workspace } = vi.hoisted(() => ({
  listForRun: vi.fn(),
  workspace: { id: 'ws-1' as string | null },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { connector: { listForRun: { query: listForRun } } },
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => workspace.id,
}));

const target = { agentId: 'agt-private', topicId: 'tpc-own' };
const rows = [{ id: 'c-personal', identifier: 'github', toolIdentifier: 'github-cpersona' }];

beforeEach(() => {
  resetRunConnectors();
  listForRun.mockReset();
  workspace.id = 'ws-1';
});
afterEach(() => vi.useRealTimers());

describe('run connectors', () => {
  it("lists a conversation's rows once refreshed, by agent and topic", async () => {
    listForRun.mockResolvedValue(rows);

    expect(getRunConnectors(target)).toBeUndefined();
    expect(await refreshRunConnectors(target)).toEqual(rows);

    expect(listForRun).toHaveBeenCalledWith(target);
    expect(getRunConnectors(target)).toEqual(rows);
    expect(getRunConnectors({ ...target, topicId: 'tpc-other' })).toBeUndefined();
    expect(getAllRunConnectors()).toEqual(rows);
  });

  it('asks nothing outside a workspace, where the local lists hold every row', async () => {
    workspace.id = null;

    expect(await refreshRunConnectors(target)).toBeUndefined();
    expect(listForRun).not.toHaveBeenCalled();
  });

  it('keeps the last listing when a refresh fails or takes too long', async () => {
    listForRun.mockResolvedValueOnce(rows);
    await refreshRunConnectors(target);

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    listForRun.mockRejectedValueOnce(new Error('offline'));
    expect(await refreshRunConnectors(target)).toEqual(rows);

    listForRun.mockReturnValueOnce(new Promise(() => {}));
    expect(await refreshRunConnectors(target, { timeoutMs: 10 })).toEqual(rows);
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTaskAcceptance } from '../taskAcceptance';

const mocks = vi.hoisted(() => ({
  acceptanceEnsure: vi.fn(),
  acceptanceFindBySubject: vi.fn(),
  acceptanceUpdate: vi.fn(),
  resolveVerifyConfig: vi.fn(),
}));

vi.mock('../acceptanceService', () => ({
  AcceptanceService: vi.fn(() => ({ ensureForSubject: mocks.acceptanceEnsure })),
}));

vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: vi.fn(() => ({
    findBySubject: mocks.acceptanceFindBySubject,
    update: mocks.acceptanceUpdate,
  })),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(() => ({ resolveVerifyConfig: mocks.resolveVerifyConfig })),
}));

const db = {} as never;

describe('resolveTaskAcceptance', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('uses Acceptance as the authoritative completion contract', async () => {
    mocks.acceptanceFindBySubject.mockResolvedValue({
      config: { maxIterations: 3, verifierAgentId: 'acceptance-agent' },
      id: 'acceptance-1',
      requirement: 'Acceptance requirement',
    });
    mocks.resolveVerifyConfig.mockResolvedValue({
      enabled: true,
      maxIterations: 1,
      requirement: 'Legacy requirement',
      verifierAgentId: 'legacy-agent',
    });

    const resolved = await resolveTaskAcceptance(db, 'user-1', 'task-1');

    expect(resolved).toMatchObject({
      acceptance: { id: 'acceptance-1' },
      config: { maxIterations: 3, verifierAgentId: 'acceptance-agent' },
      requirement: 'Acceptance requirement',
    });
  });

  it('materializes legacy task verify config into an Acceptance once', async () => {
    mocks.acceptanceFindBySubject.mockResolvedValue(null);
    mocks.resolveVerifyConfig.mockResolvedValue({
      enabled: true,
      maxIterations: 2,
      requirement: 'Legacy requirement',
      verifyRubricId: 'rubric-1',
    });
    mocks.acceptanceEnsure.mockResolvedValue({
      config: { enabled: true, maxIterations: 2, verifyRubricId: 'rubric-1' },
      id: 'acceptance-1',
      requirement: 'Legacy requirement',
    });

    const resolved = await resolveTaskAcceptance(db, 'user-1', 'task-1');

    expect(mocks.acceptanceEnsure).toHaveBeenCalledWith('task', 'task-1', {
      config: expect.objectContaining({
        enabled: true,
        maxIterations: 2,
        verifyRubricId: 'rubric-1',
      }),
      requirement: 'Legacy requirement',
    });
    expect(resolved?.acceptance.id).toBe('acceptance-1');
  });
});

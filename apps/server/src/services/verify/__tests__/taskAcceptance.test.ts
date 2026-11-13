// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { attachTaskRunToAcceptance, resolveTaskAcceptance } from '../taskAcceptance';

const mocks = vi.hoisted(() => ({
  acceptanceEnsure: vi.fn(),
  acceptanceFindPolicyBySubject: vi.fn(),
  acceptanceUpdatePolicy: vi.fn(),
  attachPolicyRun: vi.fn(),
  taskFindById: vi.fn(),
}));

vi.mock('../acceptanceService', () => ({
  AcceptanceService: vi.fn(function () {
    return { attachPolicyRun: mocks.attachPolicyRun };
  }),
}));

vi.mock('@/database/models/acceptance', () => ({
  AcceptanceModel: vi.fn(function () {
    return {
      ensureForSubject: mocks.acceptanceEnsure,
      findPolicyBySubject: mocks.acceptanceFindPolicyBySubject,
      updatePolicy: mocks.acceptanceUpdatePolicy,
    };
  }),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(function () {
    return {
      findById: mocks.taskFindById,
      getVerifyConfig: (task: { verify?: unknown }) => task.verify,
    };
  }),
}));

const db = {} as never;

describe('resolveTaskAcceptance', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('uses Acceptance as the authoritative completion contract', async () => {
    mocks.acceptanceFindPolicyBySubject.mockResolvedValue({
      config: { maxIterations: 3, verifierAgentId: 'acceptance-agent' },
      id: 'acceptance-1',
      requirement: 'Acceptance requirement',
    });
    mocks.taskFindById.mockResolvedValue({ id: 'task-1', verify: { enabled: true } });

    const resolved = await resolveTaskAcceptance(db, 'user-1', 'task-1');

    expect(resolved).toMatchObject({
      acceptance: { id: 'acceptance-1' },
      config: { maxIterations: 3, verifierAgentId: 'acceptance-agent' },
      requirement: 'Acceptance requirement',
    });
  });

  it('materializes legacy task verify config into an Acceptance once', async () => {
    mocks.acceptanceFindPolicyBySubject.mockResolvedValue(null);
    mocks.taskFindById.mockResolvedValue({
      id: 'task-1',
      verify: {
        enabled: true,
        maxIterations: 2,
        requirement: 'Legacy requirement',
        verifyRubricId: 'rubric-1',
      },
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
      projectId: undefined,
      requirement: 'Legacy requirement',
    });
    expect(resolved?.acceptance.id).toBe('acceptance-1');
  });

  it('inherits the nearest parent Acceptance and snapshots it onto the child', async () => {
    mocks.taskFindById
      .mockResolvedValueOnce({ id: 'child', parentTaskId: 'parent' })
      .mockResolvedValueOnce({ id: 'parent', parentTaskId: null });
    mocks.acceptanceFindPolicyBySubject.mockResolvedValueOnce(null).mockResolvedValueOnce({
      config: { enabled: true, verifierAgentId: 'parent-verifier' },
      id: 'parent-acceptance',
      requirement: 'Parent contract',
    });
    mocks.acceptanceEnsure.mockResolvedValue({
      config: { enabled: true, verifierAgentId: 'parent-verifier' },
      id: 'child-acceptance',
      requirement: 'Parent contract',
    });

    const resolved = await resolveTaskAcceptance(db, 'user-1', 'child', 'workspace-1');

    expect(mocks.acceptanceEnsure).toHaveBeenCalledWith('task', 'child', {
      config: { enabled: true, verifierAgentId: 'parent-verifier' },
      projectId: undefined,
      requirement: 'Parent contract',
    });
    expect(resolved?.acceptance.id).toBe('child-acceptance');
  });

  it('prefers a child legacy policy over a parent Acceptance', async () => {
    mocks.acceptanceFindPolicyBySubject.mockResolvedValue(null);
    mocks.taskFindById.mockResolvedValue({
      id: 'child',
      parentTaskId: 'parent',
      verify: { enabled: true, maxIterations: 1 },
    });
    mocks.acceptanceEnsure.mockResolvedValue({
      config: { enabled: true, maxIterations: 1 },
      id: 'child-acceptance',
    });

    const resolved = await resolveTaskAcceptance(db, 'user-1', 'child');

    expect(mocks.acceptanceFindPolicyBySubject).toHaveBeenCalledTimes(1);
    expect(resolved?.config).toMatchObject({ enabled: true, maxIterations: 1 });
  });
});

/**
 * Regression: a builder that planned its own verification round through the CLI
 * left `verify_runs.acceptance_id` null. The round passed, and then the Goal's
 * Acceptance review — which reaches a delivery only through its Acceptance —
 * errored with "no Acceptance", a failure class with no recovery branch. A
 * delivery that met every criterion was parked on a human decision gate.
 */
describe('attachTaskRunToAcceptance', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('binds an orphaned round to the acceptance that owns the task', async () => {
    await attachTaskRunToAcceptance(
      db,
      'user-1',
      { acceptanceId: 'acceptance-1', run: { acceptanceId: null, id: 'run-1' } },
      'workspace-1',
    );

    expect(mocks.attachPolicyRun).toHaveBeenCalledWith('run-1', 'acceptance-1');
  });

  it('leaves a round that already belongs to an acceptance alone', async () => {
    const run = { acceptanceId: 'acceptance-1', id: 'run-1' };

    await expect(
      attachTaskRunToAcceptance(db, 'user-1', { acceptanceId: 'acceptance-2', run }),
    ).resolves.toBe(run);
    expect(mocks.attachPolicyRun).not.toHaveBeenCalled();
  });

  it('never breaks verification when the aggregate refuses the round', async () => {
    mocks.attachPolicyRun.mockRejectedValue(new Error('This acceptance has already been accepted'));
    const run = { acceptanceId: null, id: 'run-1' };

    // The caller keeps verifying against the row it already holds.
    await expect(
      attachTaskRunToAcceptance(db, 'user-1', { acceptanceId: 'acceptance-1', run }),
    ).resolves.toBe(run);
  });

  /**
   * Regression: attaching onto an acceptance whose newest round is still a draft
   * folds this run into it and deletes the source row. A caller that kept the id it
   * passed in would go on claiming and reading a row that no longer exists.
   */
  it('hands back the row the round was folded into', async () => {
    const folded = { acceptanceId: 'acceptance-1', id: 'draft-run' };
    mocks.attachPolicyRun.mockResolvedValue(folded);

    await expect(
      attachTaskRunToAcceptance(db, 'user-1', {
        acceptanceId: 'acceptance-1',
        run: { acceptanceId: null, id: 'run-1' },
      }),
    ).resolves.toBe(folded);
  });
});

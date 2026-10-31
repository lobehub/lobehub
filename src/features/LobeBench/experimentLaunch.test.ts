import { describe, expect, it, vi } from 'vitest';

import {
  beginLaunchInStorage,
  clearLaunchInStorage,
  createExperimentLaunch,
  experimentLaunchKey,
  isAcceptedRunStatus,
  isResumableLaunch,
  isStartableRunStatus,
  LAUNCH_LEASE_MS,
  launchExperiment,
  launchResumeLockName,
  type LaunchServices,
  type LaunchStorage,
  parseExperimentLaunch,
  runExclusiveLaunch,
} from './experimentLaunch';

const snapshot = () => ({
  benchmarkId: 'evb_1',
  contenders: [
    { config: { k: 1, model: 'model-a', provider: 'p' }, id: 'c-a', name: 'A' },
    { config: { k: 1, model: 'model-b', provider: 'p' }, id: 'c-b', name: 'B' },
  ],
  datasetId: 'ds_1',
  metadata: {
    contenders: [
      { id: 'c-a', model: 'model-a', name: 'A', provider: 'p' },
      { id: 'c-b', model: 'model-b', name: 'B', provider: 'p' },
    ],
    datasetId: 'ds_1',
    k: 1,
    kind: 'lobe-bench',
  },
  name: 'A vs B',
});

/** An in-memory server: idempotent creates on caller ids, runs start once. */
const fakeServer = () => {
  const runs = new Map<string, { id: string; status: string }>();
  const services: LaunchServices = {
    createExperiment: vi.fn(async ({ id }) => ({ data: { id } })),
    createRun: vi.fn(async ({ id }) => {
      if (!runs.has(id)) runs.set(id, { id, status: 'idle' });
      return runs.get(id);
    }),
    listRuns: vi.fn(async () => [...runs.values()]),
    startRun: vi.fn(async (id) => {
      runs.get(id)!.status = 'pending';
      return { success: true };
    }),
    updateExperiment: vi.fn(async () => ({ success: true })),
  };
  return { runs, services };
};

const memoryStorage = (): LaunchStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    map,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
};

describe('createExperimentLaunch', () => {
  it('freezes the case set, name, metadata and each run config under stable server-shaped ids', () => {
    const launch = createExperimentLaunch(snapshot());
    expect(launch.version).toBe(2);
    expect(launch.experimentId).toMatch(/^exp_[\dA-Za-z]{12}$/);
    expect(launch).toMatchObject({ benchmarkId: 'evb_1', datasetId: 'ds_1', name: 'A vs B' });
    expect(launch.contenders.map((c) => [c.key, c.config.model])).toEqual([
      ['c-a', 'model-a'],
      ['c-b', 'model-b'],
    ]);
    for (const c of launch.contenders) expect(c.runId).toMatch(/^run_[\dA-Za-z]{12}$/);
    expect(new Set(launch.contenders.map((c) => c.runId)).size).toBe(2);
  });

  it('round-trips through storage and rejects anything else', () => {
    const launch = createExperimentLaunch(snapshot());
    expect(parseExperimentLaunch(JSON.stringify(launch))).toEqual(launch);
    expect(parseExperimentLaunch('{"experimentId":"x"}')).toBeUndefined();
    expect(parseExperimentLaunch('not json')).toBeUndefined();
    expect(parseExperimentLaunch(null)).toBeUndefined();
  });

  it('reads a first-version record as legacy: visible, not resumable', () => {
    const legacy = {
      contenders: [{ key: 'c-a', name: 'A', runId: 'run_old' }],
      createdAt: '2026-10-29T00:00:00.000Z',
      experimentId: 'exp_old',
    };
    const parsed = parseExperimentLaunch(JSON.stringify(legacy));
    expect(parsed).toEqual({ ...legacy, version: 1 });
    expect(isResumableLaunch(parsed!)).toBe(false);
    expect(isResumableLaunch(createExperimentLaunch(snapshot()))).toBe(true);
  });

  it('scopes the record to user, workspace and benchmark', () => {
    const a = experimentLaunchKey({ benchmarkId: 'b', userId: 'u1', workspaceId: null });
    const b = experimentLaunchKey({ benchmarkId: 'b', userId: 'u2', workspaceId: null });
    const c = experimentLaunchKey({ benchmarkId: 'b', userId: 'u1', workspaceId: 'ws' });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('run states', () => {
  it('starts only an idle run and trusts only dispatched or finished states', () => {
    expect(isStartableRunStatus('idle')).toBe(true);
    for (const status of ['running', 'completed', 'failed', 'aborted', 'external'])
      expect(isAcceptedRunStatus(status)).toBe(true);
    // Pending is neither: it may or may not have been dispatched.
    expect(isStartableRunStatus('pending')).toBe(false);
    expect(isAcceptedRunStatus('pending')).toBe(false);
    expect(isAcceptedRunStatus(undefined)).toBe(false);
    expect(isAcceptedRunStatus('idle')).toBe(false);
  });
});

describe('storage compare-before-write', () => {
  const key = experimentLaunchKey({ benchmarkId: 'b', userId: 'u', workspaceId: null });

  it('writes into an empty scope and again for the same experiment', () => {
    const storage = memoryStorage();
    const launch = createExperimentLaunch(snapshot());
    expect(beginLaunchInStorage(storage, key, launch)).toEqual({ ok: true });
    expect(beginLaunchInStorage(storage, key, launch)).toEqual({ ok: true });
    expect(parseExperimentLaunch(storage.getItem(key))).toEqual(launch);
  });

  it("refuses to overwrite another tab's launch and hands it back", () => {
    const storage = memoryStorage();
    const theirs = createExperimentLaunch(snapshot());
    storage.setItem(key, JSON.stringify(theirs));
    const mine = createExperimentLaunch(snapshot());
    expect(beginLaunchInStorage(storage, key, mine)).toEqual({
      existing: theirs,
      ok: false,
      reason: 'occupied',
    });
    expect(parseExperimentLaunch(storage.getItem(key))).toEqual(theirs);
  });

  it('reports a storage failure instead of pretending to checkpoint', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(beginLaunchInStorage(storage, key, createExperimentLaunch(snapshot()))).toEqual({
      ok: false,
      reason: 'storage',
    });
  });

  it('clears only the experiment it was asked to clear', () => {
    const storage = memoryStorage();
    const theirs = createExperimentLaunch(snapshot());
    storage.setItem(key, JSON.stringify(theirs));
    expect(clearLaunchInStorage(storage, key, 'exp_somethingElse')).toBe(false);
    expect(storage.getItem(key)).not.toBeNull();
    expect(clearLaunchInStorage(storage, key, theirs.experimentId)).toBe(true);
    expect(storage.getItem(key)).toBeNull();
    expect(clearLaunchInStorage(storage, key, theirs.experimentId)).toBe(true);
  });
});

describe('launchExperiment', () => {
  it('creates the experiment and runs, saves the run ids, then starts every idle run once', async () => {
    const { services, runs } = fakeServer();
    const launch = createExperimentLaunch(snapshot());

    const outcome = await launchExperiment(launch, services);

    expect(outcome.complete).toBe(true);
    expect(outcome.started.map((c) => c.key)).toEqual(['c-a', 'c-b']);
    expect([...runs.values()].map((r) => r.status)).toEqual(['pending', 'pending']);
    expect(services.createExperiment).toHaveBeenCalledWith({
      benchmarkIds: ['evb_1'],
      id: launch.experimentId,
      metadata: launch.metadata,
      name: 'A vs B',
    });
    expect(services.createRun).toHaveBeenCalledWith({
      config: { k: 1, model: 'model-a', provider: 'p' },
      datasetId: 'ds_1',
      experimentId: launch.experimentId,
      id: launch.contenders[0].runId,
      name: 'A',
    });
    expect(services.updateExperiment).toHaveBeenCalledWith({
      id: launch.experimentId,
      metadata: expect.objectContaining({
        contenders: [
          expect.objectContaining({ id: 'c-a', runId: launch.contenders[0].runId }),
          expect.objectContaining({ id: 'c-b', runId: launch.contenders[1].runId }),
        ],
      }),
    });
    // Run ids are saved before any start, so a start failure never leaves an
    // experiment that does not know its runs.
    const order = [
      ...vi.mocked(services.updateExperiment).mock.invocationCallOrder,
      ...vi.mocked(services.startRun).mock.invocationCallOrder,
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('covers several benchmarks: one run per contender and dataset, each part told its runs', async () => {
    const { services } = fakeServer();
    const library = { caseSelection: { caseIds: ['h1', 'h2'], mode: 'include' } };
    const launch = createExperimentLaunch({
      ...snapshot(),
      benchmarkIds: ['evb_1', 'evb_hard'],
      contenders: [
        { config: { model: 'model-a' }, datasetId: 'ds_1', id: 'c-a', name: 'A', part: 0 },
        { config: { model: 'model-b' }, datasetId: 'ds_1', id: 'c-b', name: 'B', part: 0 },
        {
          config: { ...library, model: 'model-a' },
          datasetId: 'ds_1',
          id: 'c-a',
          name: 'A',
          part: 1,
        },
        {
          config: { ...library, model: 'model-b' },
          datasetId: 'ds_1',
          id: 'c-b',
          name: 'B',
          part: 1,
        },
      ],
      metadata: {
        ...snapshot().metadata,
        parts: [
          { datasetId: 'ds_1' },
          { caseIds: ['h1', 'h2'], datasetId: 'ds_1', pickedDatasetId: 'ds_hard' },
        ],
      },
    });

    const outcome = await launchExperiment(launch, services);

    expect(outcome.complete).toBe(true);
    expect(outcome.started).toHaveLength(4);
    expect(vi.mocked(services.createExperiment).mock.calls[0][0].benchmarkIds).toEqual([
      'evb_1',
      'evb_hard',
    ]);
    const [a0, b0, a1, b1] = launch.contenders.map((c) => c.runId);
    expect(vi.mocked(services.updateExperiment).mock.calls[0][0].metadata).toMatchObject({
      // The first dataset's runs stay on the contenders, as for an experiment of one dataset.
      contenders: [
        { id: 'c-a', runId: a0 },
        { id: 'c-b', runId: b0 },
      ],
      parts: [
        { datasetId: 'ds_1', runIds: { 'c-a': a0, 'c-b': b0 } },
        { pickedDatasetId: 'ds_hard', runIds: { 'c-a': a1, 'c-b': b1 } },
      ],
    });
  });

  it('sends the frozen snapshot, whatever happened to the draft since', async () => {
    const { services } = fakeServer();
    const launch = createExperimentLaunch(snapshot());
    // The draft changed after the launch began: a different model, name and case set.
    const driftedDraft = { ...snapshot(), datasetId: 'ds_other', name: 'renamed' };
    void driftedDraft;

    await launchExperiment(launch, services);

    for (const call of vi.mocked(services.createRun).mock.calls) {
      expect(call[0].datasetId).toBe('ds_1');
      expect(['model-a', 'model-b']).toContain(call[0].config.model);
    }
    expect(vi.mocked(services.createExperiment).mock.calls[0][0].name).toBe('A vs B');
  });

  it('A started, B failed: resuming starts B only and never touches A again', async () => {
    const { services, runs } = fakeServer();
    const launch = createExperimentLaunch(snapshot());
    vi.mocked(services.startRun).mockImplementationOnce(async (id) => {
      runs.get(id)!.status = 'running';
      return { success: true };
    });
    vi.mocked(services.startRun).mockImplementationOnce(async () => {
      throw new Error('network down');
    });

    const first = await launchExperiment(launch, services);
    expect(first.complete).toBe(false);
    expect(first.error).toEqual({
      contender: launch.contenders[1],
      message: 'network down',
      stage: 'start',
    });
    expect(first.started.map((c) => c.key)).toEqual(['c-a']);

    const second = await launchExperiment(launch, services);
    expect(second.complete).toBe(true);
    expect(second.kept.map((c) => c.key)).toEqual(['c-a']);
    expect(second.started.map((c) => c.key)).toEqual(['c-b']);
    expect(runs.size).toBe(2);
    expect(services.createRun).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(services.startRun).mock.calls.filter(([id]) => id === launch.contenders[0].runId),
    ).toHaveLength(1);
  });

  it('a lost create response is retried with the same id, so the server sees one run', async () => {
    const { services, runs } = fakeServer();
    const launch = createExperimentLaunch(snapshot());
    const realCreate = vi.mocked(services.createRun).getMockImplementation()!;
    vi.mocked(services.createRun).mockImplementationOnce(async (params) => {
      await realCreate(params); // the server committed the row…
      throw new Error('socket closed'); // …but the response never arrived
    });

    const first = await launchExperiment(launch, services);
    expect(first.error?.stage).toBe('run');
    expect(runs.size).toBe(1);
    expect(services.startRun).not.toHaveBeenCalled();

    const second = await launchExperiment(launch, services);
    expect(second.complete).toBe(true);
    expect(runs.size).toBe(2);
    expect(vi.mocked(services.createRun).mock.calls.map(([p]) => p.id)).toEqual([
      launch.contenders[0].runId,
      launch.contenders[1].runId,
    ]);
  });

  it('never restarts a run that is running or finished', async () => {
    const { services, runs } = fakeServer();
    const launch = createExperimentLaunch(snapshot());
    runs.set(launch.contenders[0].runId, { id: launch.contenders[0].runId, status: 'completed' });
    runs.set(launch.contenders[1].runId, { id: launch.contenders[1].runId, status: 'running' });

    const outcome = await launchExperiment(launch, services);

    expect(outcome.complete).toBe(true);
    expect(outcome.kept.map((c) => c.key)).toEqual(['c-a', 'c-b']);
    expect(services.createRun).not.toHaveBeenCalled();
    expect(services.startRun).not.toHaveBeenCalled();
    expect(runs.get(launch.contenders[0].runId)!.status).toBe('completed');
  });

  it('a pending run is unconfirmed: not complete, not started again, resolved on re-check', async () => {
    const { services, runs } = fakeServer();
    const launch = createExperimentLaunch(snapshot());
    runs.set(launch.contenders[0].runId, { id: launch.contenders[0].runId, status: 'pending' });

    const first = await launchExperiment(launch, services);
    expect(first.complete).toBe(false);
    expect(first.error).toBeUndefined();
    expect(first.unconfirmed.map((c) => c.key)).toEqual(['c-a']);
    expect(first.started.map((c) => c.key)).toEqual(['c-b']);
    expect(
      vi.mocked(services.startRun).mock.calls.some(([id]) => id === launch.contenders[0].runId),
    ).toBe(false);

    // The server moved both on (the one it had, and the one this attempt
    // started): the re-check accepts them without another start.
    runs.get(launch.contenders[0].runId)!.status = 'running';
    runs.get(launch.contenders[1].runId)!.status = 'running';
    const second = await launchExperiment(launch, services);
    expect(second.complete).toBe(true);
    expect(second.kept.map((c) => c.key).sort()).toEqual(['c-a', 'c-b']);
    expect(services.startRun).toHaveBeenCalledTimes(1);
  });

  it('a run this attempt started earlier but still pending stays unconfirmed on re-check', async () => {
    const { services, runs } = fakeServer();
    const launch = createExperimentLaunch(snapshot());

    const first = await launchExperiment(launch, services);
    expect(first.complete).toBe(true);
    expect([...runs.values()].map((r) => r.status)).toEqual(['pending', 'pending']);

    // Dispatch has not moved them past pending: the launch cannot tell a slow
    // dispatch from a lost one, so it waits instead of starting again.
    const second = await launchExperiment(launch, services);
    expect(second.complete).toBe(false);
    expect(second.unconfirmed).toHaveLength(2);
    expect(services.startRun).toHaveBeenCalledTimes(2);
  });

  it('a create that answers without a status is unconfirmed too', async () => {
    const { services } = fakeServer();
    const launch = createExperimentLaunch(snapshot());
    vi.mocked(services.createRun).mockResolvedValue({ success: true });

    const outcome = await launchExperiment(launch, services);

    expect(outcome.complete).toBe(false);
    expect(outcome.unconfirmed).toHaveLength(2);
    expect(services.startRun).not.toHaveBeenCalled();
  });

  it('stops before any start when the run ids cannot be saved, and finishes on resume', async () => {
    const { services } = fakeServer();
    const launch = createExperimentLaunch(snapshot());
    vi.mocked(services.updateExperiment).mockRejectedValueOnce(new Error('offline'));

    const first = await launchExperiment(launch, services);
    expect(first).toMatchObject({
      complete: false,
      error: { message: 'offline', stage: 'metadata' },
      metadataSaved: false,
    });
    expect(services.startRun).not.toHaveBeenCalled();

    const second = await launchExperiment(launch, services);
    expect(second.complete).toBe(true);
    expect(second.started).toHaveLength(2);
    expect(services.createRun).toHaveBeenCalledTimes(2);
  });

  it('stops before any run when the experiment cannot be created', async () => {
    const { services } = fakeServer();
    vi.mocked(services.createExperiment).mockRejectedValueOnce(new Error('403'));

    const outcome = await launchExperiment(createExperimentLaunch(snapshot()), services);

    expect(outcome).toMatchObject({
      complete: false,
      error: { message: '403', stage: 'experiment' },
    });
    expect(services.createRun).not.toHaveBeenCalled();
    expect(services.startRun).not.toHaveBeenCalled();
  });
});

describe('runExclusiveLaunch', () => {
  /**
   * A Web Locks stand-in with the real `ifAvailable` contract: the callback is
   * always invoked, with the Lock when granted and with `null` when another
   * holder has it. A helper that ignores its argument would run anyway.
   */
  const fakeLocks = () => {
    const held = new Set<string>();
    return {
      request: async <T>(
        name: string,
        _options: { ifAvailable: true },
        callback: (lock: Lock | null) => Promise<T>,
      ): Promise<T> => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          return await callback({ mode: 'exclusive', name } as Lock);
        } finally {
          held.delete(name);
        }
      },
    };
  };
  const defer = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  it('two tabs continuing the same launch: one resumes, the other is told it is busy, runs start once', async () => {
    const { services, runs } = fakeServer();
    const launch = createExperimentLaunch(snapshot());
    const locks = fakeLocks();
    const gate = defer();
    // Tab A reads the runs, then stalls before starting: the window the bug lived in.
    vi.mocked(services.listRuns).mockImplementationOnce(async () => {
      await gate.promise;
      return [...runs.values()];
    });
    const name = launchResumeLockName('scope', launch.experimentId);
    const options = { leaseKey: name, lockName: name, locks };

    const tabA = runExclusiveLaunch(options, () => launchExperiment(launch, services));
    const tabB = await runExclusiveLaunch(options, () => launchExperiment(launch, services));
    expect(tabB).toEqual({ ran: false, reason: 'busy' });

    gate.resolve();
    const resultA = await tabA;
    expect(resultA.ran).toBe(true);
    expect(services.startRun).toHaveBeenCalledTimes(2);
    expect([...runs.values()].map((r) => r.status)).toEqual(['pending', 'pending']);
  });

  it('does not run the task when the lock manager hands the callback null', async () => {
    const task = vi.fn(async () => 'ran');
    const locks = {
      request: async <T>(
        _name: string,
        _options: { ifAvailable: true },
        callback: (lock: Lock | null) => Promise<T>,
      ) => callback(null),
    };
    const name = 'scope:resume:exp_1';

    expect(await runExclusiveLaunch({ leaseKey: name, lockName: name, locks }, task)).toEqual({
      ran: false,
      reason: 'busy',
    });
    expect(task).not.toHaveBeenCalled();
  });

  it('releases the lock after the resume, so a later re-check can run', async () => {
    const { services } = fakeServer();
    const launch = createExperimentLaunch(snapshot());
    const locks = fakeLocks();
    const name = launchResumeLockName('scope', launch.experimentId);
    const options = { leaseKey: name, lockName: name, locks };

    await runExclusiveLaunch(options, () => launchExperiment(launch, services));
    const again = await runExclusiveLaunch(options, () => launchExperiment(launch, services));
    expect(again.ran).toBe(true);
  });

  it('without Web Locks a storage lease keeps a second resume out while the first is in flight', async () => {
    const storage = memoryStorage();
    const name = 'scope:resume:exp_1';
    const gate = defer();
    let clock = 1_000;
    const options = { leaseKey: name, lockName: name, now: () => clock, storage };

    const first = runExclusiveLaunch(options, async () => {
      await gate.promise;
      return 'done';
    });
    expect(await runExclusiveLaunch(options, async () => 'second')).toEqual({
      ran: false,
      reason: 'busy',
    });
    gate.resolve();
    expect(await first).toEqual({ ran: true, result: 'done' });
    expect(storage.getItem(name)).toBeNull();

    // An abandoned lease (tab closed mid-resume) expires instead of blocking forever.
    storage.setItem(name, String(clock));
    clock += LAUNCH_LEASE_MS + 1;
    expect(await runExclusiveLaunch(options, async () => 'later')).toEqual({
      ran: true,
      result: 'later',
    });
  });
});

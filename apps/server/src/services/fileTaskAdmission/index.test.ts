// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChunkService } from '@/server/services/chunk';
import { AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';

import { FILE_TASK_QUEUE_RETRIES, holdFileTaskLease, processQueuedFileTask } from './index';

interface FakeTask {
  error?: { name?: string } | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  status: string;
  type: string;
}

interface PublishedMessage {
  body: { fileId: string; kind: 'embedding' | 'parse'; taskId: string; userId: string };
  delay?: number;
  flowControl: { key: string; parallelism: number; period: string; rate: number };
}

const h = vi.hoisted(() => ({
  createAsyncCaller: vi.fn(),
  fileEnv: { FILE_TASK_GLOBAL_CONCURRENCY: 80, FILE_TASK_WORKSPACE_CONCURRENCY: 20 },
  files: new Map<string, any>(),
  publish: vi.fn(),
  recordGlobalActive: vi.fn(),
  redisAvailable: { value: true },
  slots: {
    global: new Set<string>(),
    scopes: new Map<string, Set<string>>(),
  },
  tasks: new Map<string, any>(),
}));

vi.mock('@lobechat/observability-otel/modules/file-task-admission', () => ({
  recordFileTaskAdmission: vi.fn(),
  recordFileTaskGlobalActive: h.recordGlobalActive,
}));
vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.test', INTERNAL_APP_URL: 'http://localhost:3210' },
}));
vi.mock('@/envs/file', () => ({ fileEnv: h.fileEnv }));
vi.mock('@/envs/redis', () => ({ getRedisConfig: () => ({ enabled: true }) }));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/server/routers/async/caller', () => ({ createAsyncCaller: h.createAsyncCaller }));
vi.mock('@/server/modules/ContentChunk', () => ({
  ContentChunk: vi.fn(function () {
    return {};
  }),
}));
vi.mock('@/libs/qstash', () => ({
  OtelQstashClient: vi.fn(function () {
    return { publishJSON: h.publish };
  }),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(function () {
    return {
      findById: async (id: string) => h.files.get(id),
      update: async (id: string, value: object) => {
        h.files.set(id, { ...h.files.get(id), ...value });
      },
    };
  }),
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(function () {
    return {
      claimQueuedFileTask: async (id: string) => {
        const task = h.tasks.get(id);
        if (!task?.metadata?.fileTaskQueuedUntil) return false;
        if (task.status === 'success' || task.status === 'error') return false;
        const { fileTaskQueuedUntil: _claimed, ...metadata } = task.metadata;
        task.metadata = metadata;
        return true;
      },
      create: async ({ status, type }: { status: string; type: string }) => {
        const id = `task-${h.tasks.size}`;
        h.tasks.set(id, { id, status, type });
        return id;
      },
      findById: async (id: string) => h.tasks.get(id),
      swapFileTaskQueueMarker: async (id: string, from: string, to: Date) => {
        const task = h.tasks.get(id);
        if (task?.metadata?.fileTaskQueuedUntil !== from) return false;
        task.metadata = { ...task.metadata, fileTaskQueuedUntil: to.toISOString() };
        return true;
      },
      markFileTaskQueued: async (id: string, until: Date) => {
        const task = h.tasks.get(id);
        task.metadata = { ...task.metadata, fileTaskQueuedUntil: until.toISOString() };
      },
      update: async (id: string, value: object) => {
        Object.assign(h.tasks.get(id), value);
      },
    };
  }),
}));

vi.mock('@/server/services/redis', () => ({
  redisService: {
    fileTaskSlots: {
      acquire: async (
        scope: string,
        holder: string,
        { globalLimit, scopeLimit }: { globalLimit: number; scopeLimit: number },
      ) => {
        if (!h.redisAvailable.value) return { status: 'unavailable' };
        const held = h.slots.scopes.get(scope) ?? new Set<string>();
        h.slots.scopes.set(scope, held);
        const active = () => ({ globalActive: h.slots.global.size, scopeActive: held.size });
        if (held.has(holder)) return { ...active(), status: 'held' };
        if (held.size >= scopeLimit || h.slots.global.size >= globalLimit)
          return { ...active(), status: 'full' };
        held.add(holder);
        h.slots.global.add(holder);
        return { ...active(), status: 'acquired' };
      },
      release: async (scope: string, holder: string) => {
        h.slots.scopes.get(scope)?.delete(holder);
        h.slots.global.delete(holder);
        return h.slots.global.size;
      },
      renew: async () => undefined,
    },
  },
}));

const PARSE_MS = 41_000;
const EMBEDDING_MS = 29_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Stands in for the async routes: both hold the slot exactly as the real middleware does. */
const installRoutes = () => {
  const stats = { peakGlobal: 0, peakPerScope: new Map<string, number>(), running: 0, started: 0 };

  const observe = () => {
    stats.peakGlobal = Math.max(stats.peakGlobal, h.slots.global.size);
    for (const [scope, held] of h.slots.scopes) {
      stats.peakPerScope.set(scope, Math.max(stats.peakPerScope.get(scope) ?? 0, held.size));
    }
  };

  const parseFileToChunks = vi.fn((input: any) =>
    holdFileTaskLease(input, async () => {
      stats.started++;
      stats.running++;
      observe();
      await sleep(PARSE_MS);
      h.tasks.get(input.taskId).status = AsyncTaskStatus.Success;

      // Same hand-off as the route: the file keeps its one slot through embedding.
      const service = new ChunkService({} as any, 'user', input.workspaceId);
      if (input.admissionScope) {
        await service.asyncEmbeddingFileChunks(input.fileId, { inheritedSlot: true });
      } else {
        await service.asyncEmbeddingFileChunks(input.fileId);
      }
      stats.running--;
    }),
  );
  const embeddingChunks = vi.fn((input: any) =>
    holdFileTaskLease(input, async () => {
      observe();
      await sleep(EMBEDDING_MS);
      h.tasks.get(input.taskId).status = AsyncTaskStatus.Success;
    }),
  );

  h.createAsyncCaller.mockResolvedValue({ file: { embeddingChunks, parseFileToChunks } });

  return { embeddingChunks, parseFileToChunks, stats };
};

/** A QStash stand-in that keeps messages durably and honors delay and flow-control parallelism. */
const installQueue = () => {
  const flows = new Map<
    string,
    { active: number; ready: PublishedMessage[]; sent: number; windowEnd: number }
  >();
  let published = 0;

  const pump = (key: string) => {
    const flow = flows.get(key)!;
    while (flow.ready.length > 0 && flow.active < flow.ready[0].flowControl.parallelism) {
      const { period, rate } = flow.ready[0].flowControl;
      const now = Date.now();
      if (now >= flow.windowEnd) {
        flow.sent = 0;
        flow.windowEnd = now + Number.parseInt(period) * 1000;
      }
      if (flow.sent >= rate) {
        setTimeout(() => pump(key), flow.windowEnd - now);
        return;
      }
      flow.sent++;
      const message = flow.ready.shift()!;
      flow.active++;
      processQueuedFileTask(message.body as any, { finalAttempt: false })
        .catch(() => {
          flow.ready.push(message);
        })
        .finally(() => {
          flow.active--;
          pump(key);
        });
    }
  };

  h.publish.mockImplementation(async (message: PublishedMessage) => {
    published++;
    const { key } = message.flowControl;
    if (!flows.has(key)) flows.set(key, { active: 0, ready: [], sent: 0, windowEnd: 0 });
    setTimeout(
      () => {
        flows.get(key)!.ready.push(message);
        pump(key);
      },
      (message.delay ?? 0) * 1000,
    );
    return { messageId: `message-${published}` };
  });

  return { published: () => published };
};

const seedFiles = (count: number, prefix = 'file') =>
  Array.from({ length: count }, (_, index) => {
    const id = `${prefix}-${index}`;
    h.files.set(id, { id, name: `${id}.pdf`, size: 1024 });
    return id;
  });

const fileTasks = (fileIds: string[], key: 'chunkTaskId' | 'embeddingTaskId') =>
  fileIds.map((id) => h.tasks.get(h.files.get(id)[key]));

const drain = async (isDone: () => boolean, maxSimulatedMs = 6 * 60 * 60 * 1000) => {
  for (let elapsed = 0; elapsed < maxSimulatedMs && !isDone(); elapsed += 1000) {
    await vi.advanceTimersByTimeAsync(1000);
  }
};

const settleTriggers = () => vi.advanceTimersByTimeAsync(0);

const allSucceeded = (fileIds: string[]) => () =>
  fileIds.every((id) => {
    const file = h.files.get(id);
    return (
      h.tasks.get(file.chunkTaskId)?.status === AsyncTaskStatus.Success &&
      h.tasks.get(file.embeddingTaskId)?.status === AsyncTaskStatus.Success
    );
  });

describe('file task admission', () => {
  const originalToken = process.env.QSTASH_TOKEN;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.QSTASH_TOKEN = 'test-token';
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'current-key');
    vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', 'next-key');
    h.fileEnv.FILE_TASK_GLOBAL_CONCURRENCY = 80;
    h.fileEnv.FILE_TASK_WORKSPACE_CONCURRENCY = 20;
    h.files.clear();
    h.tasks.clear();
    h.slots.global.clear();
    h.slots.scopes.clear();
    h.redisAvailable.value = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (originalToken === undefined) delete process.env.QSTASH_TOKEN;
    else process.env.QSTASH_TOKEN = originalToken;
  });

  it('keeps a 1,000-file workspace import under the limit and finishes every file', async () => {
    const { parseFileToChunks, stats } = installRoutes();
    const queue = installQueue();
    const fileIds = seedFiles(1000);
    const service = new ChunkService({} as any, 'user', 'ws-1');

    await Promise.all(fileIds.map((id) => service.asyncParseFileToChunks(id)));
    await settleTriggers();
    expect(parseFileToChunks).toHaveBeenCalledTimes(20);

    await drain(allSucceeded(fileIds));

    expect(allSucceeded(fileIds)()).toBe(true);
    expect(stats.peakPerScope.get('workspace:ws-1')).toBe(20);
    expect(stats.started).toBe(1000);
    expect(new Set(parseFileToChunks.mock.calls.map(([input]) => input.taskId)).size).toBe(1000);
    expect(h.slots.global.size).toBe(0);
    // The delivery rate keeps a waiting backlog from cycling through QStash.
    expect(queue.published()).toBeLessThan(10_000);
  }, 60_000);

  it('applies the deployment-wide limit across workspaces', async () => {
    h.fileEnv.FILE_TASK_GLOBAL_CONCURRENCY = 30;
    const { stats } = installRoutes();
    installQueue();
    const groups = ['a', 'b', 'c'].map((workspace) => ({
      fileIds: seedFiles(40, workspace),
      service: new ChunkService({} as any, 'user', workspace),
    }));

    await Promise.all(
      groups.flatMap(({ fileIds, service }) =>
        fileIds.map((id) => service.asyncParseFileToChunks(id)),
      ),
    );
    const all = groups.flatMap(({ fileIds }) => fileIds);
    await drain(allSucceeded(all));

    expect(allSucceeded(all)()).toBe(true);
    expect(stats.peakGlobal).toBe(30);
    for (const peak of stats.peakPerScope.values()) expect(peak).toBeLessThanOrEqual(20);
  }, 30_000);

  it('starts a small batch directly, without touching the queue', async () => {
    const { parseFileToChunks } = installRoutes();
    installQueue();
    const fileIds = seedFiles(5);
    const service = new ChunkService({} as any, 'user', 'ws-1');

    await Promise.all(fileIds.map((id) => service.asyncParseFileToChunks(id)));
    await settleTriggers();

    expect(parseFileToChunks).toHaveBeenCalledTimes(5);
    expect(h.publish).not.toHaveBeenCalled();

    await drain(allSucceeded(fileIds));
    expect(h.slots.global.size).toBe(0);
  });

  it('starts directly when admission is turned off', async () => {
    h.fileEnv.FILE_TASK_WORKSPACE_CONCURRENCY = 0;
    const { parseFileToChunks } = installRoutes();
    const fileIds = seedFiles(30);
    const service = new ChunkService({} as any, 'user', 'ws-1');

    await Promise.all(fileIds.map((id) => service.asyncParseFileToChunks(id)));
    await settleTriggers();

    expect(parseFileToChunks).toHaveBeenCalledTimes(30);
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.slots.global.size).toBe(0);
  });

  it('starts directly when the queue route could not verify a delivery', async () => {
    vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', '');
    const { parseFileToChunks } = installRoutes();
    const fileIds = seedFiles(30);
    const service = new ChunkService({} as any, 'user', 'ws-1');

    await Promise.all(fileIds.map((id) => service.asyncParseFileToChunks(id)));
    await settleTriggers();

    expect(parseFileToChunks).toHaveBeenCalledTimes(30);
    expect(h.publish).not.toHaveBeenCalled();
  });

  it('sends tasks to the queue while Redis is down instead of fanning out', async () => {
    h.redisAvailable.value = false;
    const { parseFileToChunks } = installRoutes();
    h.publish.mockResolvedValue({ messageId: 'message' });
    const [fileId] = seedFiles(1);

    await new ChunkService({} as any, 'user', 'ws-1').asyncParseFileToChunks(fileId);

    expect(parseFileToChunks).not.toHaveBeenCalled();
    expect(h.publish).toHaveBeenCalledTimes(1);
    // QStash cannot reach the in-container address.
    expect(h.publish.mock.calls[0][0].url).toBe(
      'https://app.test/api/workflows/file-task/dispatch',
    );
  });

  it('marks the task failed when it can be neither started nor queued', async () => {
    h.fileEnv.FILE_TASK_WORKSPACE_CONCURRENCY = 1;
    installRoutes();
    h.publish.mockRejectedValue(new Error('qstash down'));
    const [first, second] = seedFiles(2);
    const service = new ChunkService({} as any, 'user', 'ws-1');

    await service.asyncParseFileToChunks(first);
    await service.asyncParseFileToChunks(second);

    const [task] = fileTasks([second], 'chunkTaskId');
    expect(task.status).toBe(AsyncTaskStatus.Error);
    expect(task.error.name).toBe(AsyncTaskErrorType.TaskTriggerError);
  });

  describe('queue delivery', () => {
    const queuedUntil = '2030-01-01T00:00:00.000Z';
    const queuedTask = (status: string = AsyncTaskStatus.Processing): FakeTask => {
      const task: FakeTask = {
        id: 'queued-task',
        metadata: { fileTaskQueuedUntil: queuedUntil },
        status,
        type: 'chunk',
      };
      h.tasks.set(task.id, task);
      return task;
    };
    const ref = {
      fileId: 'file',
      kind: 'parse' as const,
      queuedUntil,
      taskId: 'queued-task',
      userId: 'user',
      workspaceId: 'ws-1',
    };

    it('starts a task once when QStash delivers it twice', async () => {
      queuedTask();
      const parseFileToChunks = vi.fn().mockResolvedValue({ success: true });
      h.createAsyncCaller.mockResolvedValue({ file: { parseFileToChunks } });

      const outcomes = await Promise.all([
        processQueuedFileTask(ref, { finalAttempt: false }),
        processQueuedFileTask(ref, { finalAttempt: false }),
      ]);

      expect(outcomes.sort()).toEqual(['skipped', 'started']);
      expect(parseFileToChunks).toHaveBeenCalledTimes(1);
    });

    describe('when another delivery wins the claim during the wait for a slot', () => {
      const waitThenLoseClaim = async (status: string) => {
        h.fileEnv.FILE_TASK_WORKSPACE_CONCURRENCY = 1;
        h.slots.scopes.set('workspace:ws-1', new Set(['other']));
        h.slots.global.add('other');
        const task = queuedTask();

        const delivery = processQueuedFileTask(ref, { finalAttempt: false });
        await vi.advanceTimersByTimeAsync(0);

        task.metadata = {};
        task.status = status;
        h.slots.scopes.get('workspace:ws-1')!.delete('other');
        h.slots.global.delete('other');
        await vi.advanceTimersByTimeAsync(3000);

        await expect(delivery).resolves.toBe('skipped');
      };

      it('gives back the slot it took for a task that already finished', async () => {
        await waitThenLoseClaim(AsyncTaskStatus.Success);

        expect(h.slots.global.size).toBe(0);
      });

      it('keeps the slot while the winning delivery may be running under it', async () => {
        await waitThenLoseClaim(AsyncTaskStatus.Processing);

        expect(h.slots.global.has(ref.taskId)).toBe(true);
      });
    });

    it('goes back in the queue when no slot opens within the delivery', async () => {
      h.fileEnv.FILE_TASK_WORKSPACE_CONCURRENCY = 1;
      h.slots.scopes.set('workspace:ws-1', new Set(['other']));
      h.slots.global.add('other');
      queuedTask();
      h.publish.mockResolvedValue({ messageId: 'message' });

      const delivery = processQueuedFileTask(ref, { finalAttempt: false });
      await vi.advanceTimersByTimeAsync(60_000);

      await expect(delivery).resolves.toBe('deferred');
      expect(h.publish).toHaveBeenCalledWith(expect.objectContaining({ delay: 10 }));
      const [{ body }] = h.publish.mock.calls[0];
      expect(body.queuedUntil).not.toBe(queuedUntil);
      expect(h.tasks.get(ref.taskId).metadata.fileTaskQueuedUntil).toBe(body.queuedUntil);
    });

    it('lets only one duplicate requeue, and ignores the stale copy afterwards', async () => {
      h.fileEnv.FILE_TASK_WORKSPACE_CONCURRENCY = 1;
      h.slots.scopes.set('workspace:ws-1', new Set(['other']));
      h.slots.global.add('other');
      queuedTask();
      h.publish.mockResolvedValue({ messageId: 'message' });

      const deliveries = Promise.all([
        processQueuedFileTask(ref, { finalAttempt: false }),
        processQueuedFileTask(ref, { finalAttempt: false }),
      ]);
      await vi.advanceTimersByTimeAsync(10_000);

      expect((await deliveries).sort()).toEqual(['deferred', 'skipped']);
      await expect(processQueuedFileTask(ref, { finalAttempt: false })).resolves.toBe('skipped');
    });

    it('keeps the task redeliverable when the requeue cannot be published', async () => {
      h.fileEnv.FILE_TASK_WORKSPACE_CONCURRENCY = 1;
      h.slots.scopes.set('workspace:ws-1', new Set(['other']));
      h.slots.global.add('other');
      queuedTask();
      h.publish.mockRejectedValue(new Error('qstash down'));

      const delivery = processQueuedFileTask(ref, { finalAttempt: false });
      const settled = expect(delivery).rejects.toThrow('qstash down');
      await vi.advanceTimersByTimeAsync(10_000);
      await settled;

      expect(h.tasks.get(ref.taskId).metadata.fileTaskQueuedUntil).toBe(queuedUntil);
    });

    it('drains queued tasks right away once admission is turned off', async () => {
      h.fileEnv.FILE_TASK_WORKSPACE_CONCURRENCY = 0;
      queuedTask();
      const parseFileToChunks = vi.fn().mockResolvedValue({ success: true });
      h.createAsyncCaller.mockResolvedValue({ file: { parseFileToChunks } });

      await expect(processQueuedFileTask(ref, { finalAttempt: false })).resolves.toBe('started');

      expect(parseFileToChunks).toHaveBeenCalledTimes(1);
      expect(parseFileToChunks.mock.calls[0][0].admissionScope).toBeUndefined();
      expect(h.publish).not.toHaveBeenCalled();
    });

    it('asks for a redelivery when the route was unavailable, keeping the task queued', async () => {
      queuedTask();
      const unavailable = Object.assign(new Error('503'), { data: { httpStatus: 503 } });
      const parseFileToChunks = vi.fn().mockRejectedValue(unavailable);
      h.createAsyncCaller.mockResolvedValue({ file: { parseFileToChunks } });

      await expect(processQueuedFileTask(ref, { finalAttempt: false })).rejects.toBe(unavailable);

      expect(h.tasks.get(ref.taskId).metadata.fileTaskQueuedUntil).toBe(queuedUntil);
      expect(h.slots.global.size).toBe(0);
    });

    it('records a failure on the last attempt so the user can retry', async () => {
      queuedTask();
      const unavailable = Object.assign(new Error('503'), { data: { httpStatus: 503 } });
      h.createAsyncCaller.mockResolvedValue({
        file: { parseFileToChunks: vi.fn().mockRejectedValue(unavailable) },
      });

      await expect(processQueuedFileTask(ref, { finalAttempt: true })).resolves.toBe('failed');

      const task = h.tasks.get(ref.taskId);
      expect(task.status).toBe(AsyncTaskStatus.Error);
      expect(task.error.name).toBe(AsyncTaskErrorType.TaskTriggerError);
      expect(FILE_TASK_QUEUE_RETRIES).toBeGreaterThan(0);
    });

    it('keeps the result the route recorded itself', async () => {
      const task = queuedTask(AsyncTaskStatus.Pending);
      const forbidden = Object.assign(new Error('quota'), { data: { httpStatus: 403 } });
      h.createAsyncCaller.mockResolvedValue({
        file: {
          parseFileToChunks: vi.fn().mockImplementation(async () => {
            task.status = AsyncTaskStatus.Error;
            task.error = { name: AsyncTaskErrorType.EmbeddingQuotaExceeded };
            throw forbidden;
          }),
        },
      });

      await expect(processQueuedFileTask(ref, { finalAttempt: false })).resolves.toBe('failed');

      expect(task.error?.name).toBe(AsyncTaskErrorType.EmbeddingQuotaExceeded);
    });

    it('ignores a delivery for a task that already finished', async () => {
      queuedTask(AsyncTaskStatus.Success);
      const parseFileToChunks = vi.fn();
      h.createAsyncCaller.mockResolvedValue({ file: { parseFileToChunks } });

      await expect(processQueuedFileTask(ref, { finalAttempt: false })).resolves.toBe('skipped');

      expect(parseFileToChunks).not.toHaveBeenCalled();
    });
  });

  it('releases the slot when the route throws', async () => {
    h.slots.scopes.set('workspace:ws-1', new Set(['task']));
    h.slots.global.add('task');

    await expect(
      holdFileTaskLease({ admissionScope: 'workspace:ws-1', taskId: 'task' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(h.slots.global.has('task')).toBe(false);
  });

  it('keeps the slot until work the route stopped waiting for has settled', async () => {
    h.slots.scopes.set('workspace:ws-1', new Set(['task']));
    h.slots.global.add('task');
    let finish!: () => void;
    const background = new Promise<void>((resolve) => (finish = resolve));

    await holdFileTaskLease(
      { admissionScope: 'workspace:ws-1', taskId: 'task' },
      async (holdUntil) => holdUntil(background),
    );
    expect(h.slots.global.has('task')).toBe(true);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.slots.global.has('task')).toBe(false);
  });

  it('reports the active count falling to zero when the last slot frees up', async () => {
    h.slots.scopes.set('workspace:ws-1', new Set(['task']));
    h.slots.global.add('task');

    await holdFileTaskLease({ admissionScope: 'workspace:ws-1', taskId: 'task' }, async () => 'ok');

    expect(h.recordGlobalActive).toHaveBeenLastCalledWith(0);
  });
});

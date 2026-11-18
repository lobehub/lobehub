import debug from 'debug';

import { getServerDB } from '@/database/server';
import { sweepGoals } from '@/server/services/goal/sweep';
import { sweepInboundWebhooks } from '@/server/services/inboundWebhook/sweep';
import { dispatchScheduledTasks } from '@/server/services/taskRunner/scheduleDispatch';

const log = debug('lobe-server:builtin-scheduler');

const MINUTE_MS = 60 * 1000;
/** Fire a second into each minute so a timer that wakes a hair early still lands in it. */
const TICK_OFFSET_MS = 1000;

export interface BuiltinSchedulerJob {
  /** Runs on every wall-clock minute divisible by this, like cron `*\/N`. */
  everyMinutes: number;
  /** The QStash Schedule this job stands in for. */
  id: string;
  /** The workflow route that QStash Schedule calls. */
  path: string;
  /** Run once. Returns a summary when it did work, so idle ticks stay out of the log. */
  run: () => Promise<string | undefined>;
}

/**
 * The same recurring jobs `QSTASH_SCHEDULES` in `scripts/serverLauncher/startServer.js`
 * registers, called in-process instead of over HTTP. Keep the two lists in step.
 *
 * Task dispatch runs every minute rather than QStash's ten: inline dispatch has
 * no delayed delivery, so this is what makes a cron time fire on its minute.
 * Running on several replicas is safe — each occurrence is reserved with a
 * compare-and-set on the task row before it runs.
 */
export const BUILTIN_SCHEDULER_JOBS: BuiltinSchedulerJob[] = [
  {
    everyMinutes: 5,
    id: 'lobe-inbound-webhook-sweep',
    path: '/api/workflows/inbound-webhook/sweep',
    run: async () => {
      const { maintained, wakes } = await sweepInboundWebhooks(await getServerDB());
      return maintained || wakes ? `maintained=${maintained} wakes=${wakes}` : undefined;
    },
  },
  {
    everyMinutes: 1,
    id: 'lobe-task-schedule-dispatch',
    path: '/api/workflows/task/schedule-dispatch',
    run: async () => {
      const { dispatched, due, total } = await dispatchScheduledTasks();
      return due ? `total=${total} due=${due} dispatched=${dispatched}` : undefined;
    },
  },
  {
    everyMinutes: 5,
    id: 'lobe-goal-sweep',
    path: '/api/workflows/goal/sweep',
    run: async () => {
      const { advanced, stalled } = await sweepGoals();
      return stalled ? `stalled=${stalled} advanced=${advanced}` : undefined;
    },
  },
];

/**
 * In-process cron for a long-running server without QStash. Without it a
 * self-hosted deployment saves cron-pattern tasks that never start, since
 * nothing else calls the dispatcher (lobehub/lobehub#15514).
 */
export class BuiltinScheduler {
  private readonly running = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly jobs: BuiltinSchedulerJob[] = BUILTIN_SCHEDULER_JOBS) {}

  get started() {
    return !!this.timer;
  }

  start() {
    if (this.timer) return;
    this.scheduleNextTick();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Run every job due on the minute `at` falls in. */
  async tick(at: Date) {
    const minute = Math.floor(at.getTime() / MINUTE_MS);
    await Promise.all(
      this.jobs.filter((job) => minute % job.everyMinutes === 0).map((job) => this.runJob(job)),
    );
  }

  private scheduleNextTick() {
    const delay = MINUTE_MS - (Date.now() % MINUTE_MS) + TICK_OFFSET_MS;
    this.timer = setTimeout(() => {
      this.scheduleNextTick();
      void this.tick(new Date());
    }, delay);
    // Never keep a process alive just to run the next tick.
    this.timer.unref?.();
  }

  private async runJob(job: BuiltinSchedulerJob) {
    // A slow run (a large sweep, a cold database) must not stack up behind itself;
    // the next due minute picks up whatever it left.
    if (this.running.has(job.id)) {
      log('skip %s: previous run still in progress', job.id);
      return;
    }
    this.running.add(job.id);
    try {
      const summary = await job.run();
      if (summary) console.info(`[builtin-scheduler] ${job.id}: ${summary}`);
      else log('%s: idle', job.id);
    } catch (error) {
      console.error(`[builtin-scheduler] ${job.id} failed:`, error);
    } finally {
      this.running.delete(job.id);
    }
  }
}

type BuiltinSchedulerGlobal = typeof globalThis & { __lobeBuiltinScheduler?: BuiltinScheduler };

/**
 * Start the process-wide scheduler once. Idempotent across repeated
 * instrumentation `register()` calls and dev hot reloads.
 */
export const startBuiltinScheduler = (): BuiltinScheduler => {
  const g = globalThis as BuiltinSchedulerGlobal;
  if (g.__lobeBuiltinScheduler?.started) return g.__lobeBuiltinScheduler;

  const scheduler = new BuiltinScheduler();
  scheduler.start();
  g.__lobeBuiltinScheduler = scheduler;

  console.info(
    `⏰ Built-in scheduler started: no QStash Schedules drive this server, so it runs ${BUILTIN_SCHEDULER_JOBS.map(
      (job) => `${job.id} (every ${job.everyMinutes} min)`,
    ).join(', ')}.`,
  );
  return scheduler;
};

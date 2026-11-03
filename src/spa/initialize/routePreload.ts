import { preloadRegisteredRoute } from '@/spa/router/routePreloadRegistry';

type RoutePreloadPriority = 'high' | 'low' | 'medium';

export interface RoutePreloadTask {
  id: string;
  idleDelay: number;
  load: () => Promise<void>;
  matches: (pathname: string) => boolean;
  priority: RoutePreloadPriority;
}

interface NetworkInformationLike {
  effectiveType?: string;
  saveData?: boolean;
}

interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining: () => number;
}

interface RoutePreloadSchedulerOptions {
  document?: Document;
  now?: () => number;
  window?: Window;
}

const priorityWeight: Record<RoutePreloadPriority, number> = {
  high: 3,
  low: 1,
  medium: 2,
};

const matchesRoute = (segment: string) => {
  const routePattern = new RegExp(`^/(?:[^/]+/)?${segment}(?:/|$)`);

  return (pathname: string) => routePattern.test(pathname);
};

type RoutePreloadDefinition = Omit<RoutePreloadTask, 'load'>;

const createTask = (definition: RoutePreloadDefinition): RoutePreloadTask => ({
  ...definition,
  load: () => preloadRegisteredRoute(definition.id),
});

const createWebRoutePreloadTasks = (): RoutePreloadTask[] => [
  createTask({
    id: 'agent',
    idleDelay: 1500,
    matches: matchesRoute('agent'),
    priority: 'high',
  }),
  createTask({
    id: 'agents',
    idleDelay: 1500,
    matches: matchesRoute('agents'),
    priority: 'high',
  }),
  createTask({
    id: 'tasks',
    idleDelay: 2500,
    matches: matchesRoute('(?:tasks|task|agent/[^/]+/task)'),
    priority: 'high',
  }),
  createTask({
    id: 'group',
    idleDelay: 4000,
    matches: matchesRoute('group'),
    priority: 'medium',
  }),
  createTask({
    id: 'community',
    idleDelay: 6000,
    matches: matchesRoute('community'),
    priority: 'medium',
  }),
  createTask({
    id: 'settings',
    idleDelay: 8000,
    matches: matchesRoute('settings'),
    priority: 'medium',
  }),
  createTask({
    id: 'resource',
    idleDelay: 10_000,
    matches: matchesRoute('resource'),
    priority: 'low',
  }),
  createTask({
    id: 'memory',
    idleDelay: 12_000,
    matches: matchesRoute('memory'),
    priority: 'low',
  }),
  createTask({
    id: 'page',
    idleDelay: Number.POSITIVE_INFINITY,
    matches: matchesRoute('page'),
    priority: 'low',
  }),
  createTask({
    id: 'image',
    idleDelay: Number.POSITIVE_INFINITY,
    matches: matchesRoute('image'),
    priority: 'low',
  }),
  createTask({
    id: 'video',
    idleDelay: Number.POSITIVE_INFINITY,
    matches: matchesRoute('video'),
    priority: 'low',
  }),
  createTask({
    id: 'eval',
    idleDelay: Number.POSITIVE_INFINITY,
    matches: matchesRoute('eval'),
    priority: 'low',
  }),
];

const createMobileRoutePreloadTasks = (): RoutePreloadTask[] => [
  createTask({
    id: 'mobile-home',
    idleDelay: 1500,
    matches: (pathname) => pathname === '/',
    priority: 'high',
  }),
  createTask({
    id: 'mobile-agent',
    idleDelay: 2500,
    matches: matchesRoute('agent'),
    priority: 'high',
  }),
  createTask({
    id: 'mobile-agents',
    idleDelay: 2500,
    matches: matchesRoute('agents'),
    priority: 'high',
  }),
  createTask({
    id: 'mobile-tasks',
    idleDelay: 4000,
    matches: matchesRoute('(?:tasks|task|agent/[^/]+/task)'),
    priority: 'medium',
  }),
  createTask({
    id: 'mobile-community',
    idleDelay: 6000,
    matches: matchesRoute('community'),
    priority: 'medium',
  }),
  createTask({
    id: 'mobile-settings',
    idleDelay: 8000,
    matches: matchesRoute('settings'),
    priority: 'low',
  }),
];

const getConnection = (targetWindow: Window): NetworkInformationLike | undefined => {
  const navigatorWithConnection = targetWindow.navigator as Navigator & {
    connection?: NetworkInformationLike;
    mozConnection?: NetworkInformationLike;
    webkitConnection?: NetworkInformationLike;
  };

  return (
    navigatorWithConnection.connection ||
    navigatorWithConnection.mozConnection ||
    navigatorWithConnection.webkitConnection
  );
};

export const shouldSkipRoutePreload = (targetWindow: Window) => {
  const connection = getConnection(targetWindow);

  return Boolean(
    connection?.saveData || /(?:^|-)2g$/.test(connection?.effectiveType?.toLowerCase() || ''),
  );
};

const scheduleIdle = (targetWindow: Window, callback: (deadline: IdleDeadlineLike) => void) => {
  const requestIdleCallback = (
    targetWindow as typeof targetWindow & {
      requestIdleCallback?: (
        callback: (deadline: IdleDeadlineLike) => void,
        options?: { timeout?: number },
      ) => number;
    }
  ).requestIdleCallback;

  if (requestIdleCallback) {
    requestIdleCallback(callback, { timeout: 3000 });
    return;
  }

  targetWindow.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 16 }), 200);
};

export const createRoutePreloadScheduler = (
  tasks: RoutePreloadTask[],
  options: RoutePreloadSchedulerOptions = {},
) => {
  const targetWindow = options.window ?? window;
  const targetDocument = options.document ?? document;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const completed = new Set(
    tasks.filter((task) => task.matches(targetWindow.location.pathname)).map((task) => task.id),
  );
  let started = false;
  let idleScheduled = false;

  const sortedTasks = [...tasks].sort(
    (a, b) => priorityWeight[b.priority] - priorityWeight[a.priority] || a.idleDelay - b.idleDelay,
  );

  const preload = async (task: RoutePreloadTask) => {
    if (completed.has(task.id)) return;
    completed.add(task.id);

    try {
      await task.load();
    } catch (error) {
      completed.delete(task.id);
      if (__DEV__) console.warn('[RoutePreload] failed', task.id, error);
    }
  };

  const pendingIdleTasks = () =>
    sortedTasks.filter((task) => !completed.has(task.id) && Number.isFinite(task.idleDelay));

  const scheduleNextIdleTask = () => {
    if (idleScheduled || targetDocument.hidden) return;

    const pending = pendingIdleTasks();
    if (pending.length === 0) return;

    const elapsed = now() - startedAt;
    const dueTask = pending.find((task) => task.idleDelay <= elapsed);
    if (!dueTask) {
      const wait = Math.max(0, Math.min(...pending.map((task) => task.idleDelay - elapsed)));
      targetWindow.setTimeout(scheduleNextIdleTask, wait);
      return;
    }

    idleScheduled = true;
    scheduleIdle(targetWindow, (deadline) => {
      idleScheduled = false;

      if (!deadline.didTimeout && deadline.timeRemaining() < 8) {
        targetWindow.setTimeout(scheduleNextIdleTask, 500);
        return;
      }

      void preload(dueTask).finally(() => {
        targetWindow.setTimeout(scheduleNextIdleTask, 500);
      });
    });
  };

  const preloadFromIntent = (event: Event) => {
    const anchor =
      event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor) return;

    let url: URL;
    try {
      url = new URL(anchor.href, targetWindow.location.href);
    } catch {
      return;
    }

    if (url.origin !== targetWindow.location.origin) return;
    const task = sortedTasks.find((candidate) => candidate.matches(url.pathname));
    if (task) void preload(task);
  };

  const resumeWhenVisible = () => {
    if (!targetDocument.hidden) scheduleNextIdleTask();
  };

  return {
    start: () => {
      if (started || shouldSkipRoutePreload(targetWindow)) return;
      started = true;

      targetDocument.addEventListener('pointerover', preloadFromIntent, { capture: true });
      targetDocument.addEventListener('focusin', preloadFromIntent, { capture: true });
      targetDocument.addEventListener('touchstart', preloadFromIntent, {
        capture: true,
        passive: true,
      });
      targetDocument.addEventListener('visibilitychange', resumeWhenVisible);

      scheduleNextIdleTask();
    },
  };
};

let routePreloadStarted = false;

export const startRoutePreload = () => {
  if (routePreloadStarted || typeof window === 'undefined') return;
  routePreloadStarted = true;

  const tasks = __MOBILE__ ? createMobileRoutePreloadTasks() : createWebRoutePreloadTasks();
  createRoutePreloadScheduler(tasks).start();
};

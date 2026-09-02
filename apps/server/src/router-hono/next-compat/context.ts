import { AsyncLocalStorage } from 'node:async_hooks';

import type { MiddlewareHandler } from 'hono';

export type AfterTask = Promise<unknown> | (() => unknown | Promise<unknown>);

export interface RequestContext {
  afterTasks: AfterTask[];
  request: Request;
  responseHeaders: Headers;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const getRequestContext = () => storage.getStore();

export const requireRequestContext = (api: string): RequestContext => {
  const context = storage.getStore();
  if (!context)
    throw new Error(
      `\`${api}\` was called outside a request scope. Read more: https://nextjs.org/docs/messages/next-dynamic-api-wrong-context`,
    );

  return context;
};

export const runWithRequestContext = <T>(request: Request, fn: () => T): T =>
  storage.run({ afterTasks: [], request, responseHeaders: new Headers() }, fn);

const pendingAfterTasks = new Set<Promise<void>>();

export const runAfterTask = (task: AfterTask) => {
  const pending: Promise<void> = Promise.resolve()
    .then(() => (typeof task === 'function' ? task() : task))
    .then(
      () => {},
      (error) => {
        console.error('[next-compat] after() task failed:', error);
      },
    )
    .finally(() => pendingAfterTasks.delete(pending));
  pendingAfterTasks.add(pending);

  return pending;
};

export const drainAfterTasks = async () => {
  while (pendingAfterTasks.size > 0) await Promise.allSettled(pendingAfterTasks);
};

export const nextCompat = (): MiddlewareHandler => async (c, next) => {
  const context: RequestContext = {
    afterTasks: [],
    request: c.req.raw,
    responseHeaders: new Headers(),
  };

  await storage.run(context, next);

  const setCookies = context.responseHeaders.getSetCookie();
  if (setCookies.length > 0) {
    const response = new Response(c.res.body, c.res);
    for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
    c.res = response;
  }

  if (context.afterTasks.length > 0) {
    const tasks = context.afterTasks;
    setImmediate(() => {
      for (const task of tasks) void runAfterTask(task);
    });
  }
};

import type { LoaderFunctionArgs } from 'react-router';

/**
 * Route-table entry for the Tasks page's scheduled-tab pre-paint hydrate. The
 * route tables sit in the entry chunk's static graph; resolving the real loader
 * on first use keeps the task store in the tasks routes' lazy chunks.
 */
export const taskListLoader = (args: LoaderFunctionArgs) =>
  import('@/routes/(main)/tasks/taskListLoader').then((module) => module.taskListLoader(args));

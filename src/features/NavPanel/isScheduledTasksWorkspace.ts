import { parseRootSegment, RESERVED_ROOT_SEGMENTS } from '@/features/Workspace/rootSegments';

/** Global Tasks is the scheduled workspace; scoped agent/project lists retain their tabs. */
export const isScheduledTasksWorkspace = (pathname: string, search: string) => {
  const root = parseRootSegment(pathname);
  const path =
    root && !RESERVED_ROOT_SEGMENTS.has(root) ? pathname.slice(root.length + 1) : pathname;
  return (
    /^\/tasks\/?$/.test(path) ||
    (/^\/(?:agent|project)\/[^/]+\/tasks\/?$/.test(path) &&
      new URLSearchParams(search).get('collection') === 'scheduled')
  );
};

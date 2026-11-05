import { taskDetailPath } from './taskDetailPath';

export const canonicalTaskPath = (input: {
  aid?: string;
  hash: string;
  taskRef: string;
  search: string;
  title?: string | null;
  workspaceSlug?: string;
}) =>
  `${input.workspaceSlug ? `/${input.workspaceSlug}` : ''}${taskDetailPath(input.taskRef, input.aid, input.title)}${input.search}${input.hash}`;

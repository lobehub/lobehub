import path from 'node:path';

const FORBIDDEN = [
  /^src\/services\//,
  /^src\/libs\/trpc\//,
  /^src\/store\/(?!middleware\/)/,
  /\/@xyflow\//,
];

export const findForbiddenModules = (ids, repoRoot) =>
  ids
    .filter((id) => !id.startsWith('\0'))
    .map((id) => path.relative(repoRoot, id.split('?')[0]))
    .filter((id) => FORBIDDEN.some((pattern) => pattern.test(id)));

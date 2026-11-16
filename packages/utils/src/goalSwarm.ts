/** Directory under a swarm workspace that holds one copy of it per lane. */
export const SWARM_LANES_DIR = '.lanes';
export const MAX_SWARM_LANES = 8;

/** `A`, `B`, … — a lane's key, also its directory name. */
export const swarmLaneKeys = (count: number) =>
  Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index));

const trimEnd = (path: string) => path.replace(/[/\\]+$/, '');

/** Absolute directory of one lane. */
export const swarmLaneDirectory = (workspace: string, key: string) =>
  `${trimEnd(workspace)}/${SWARM_LANES_DIR}/${key}`;

/**
 * The workspace and lane key of a lane directory, or undefined when `path` is
 * not `<workspace>/.lanes/<key>` (or a directory below it).
 */
export const parseSwarmLanePath = (
  path: string,
): { key: string; workspace: string } | undefined => {
  const parts = trimEnd(path).split(/[/\\]/);
  const at = parts.lastIndexOf(SWARM_LANES_DIR);
  if (at <= 0 || at === parts.length - 1) return undefined;
  const key = parts[at + 1];
  if (!/^[\w-]+$/.test(key) || key.startsWith('_') || key.startsWith('.')) return undefined;
  return { key, workspace: parts.slice(0, at).join('/') || '/' };
};

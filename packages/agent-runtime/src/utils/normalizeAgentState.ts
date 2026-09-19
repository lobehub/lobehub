import type { AgentState } from '../types';

/**
 * Legacy `state.metadata` keys that now have a typed home on the state, and
 * the slot path each one moves to. Kept as data so the lift and the key strip
 * stay in sync and the mapping is greppable from either side.
 */
const LEGACY_KEY_PATHS: Record<string, readonly string[]> = {
  // --- origin: conversation node ---
  agentId: ['origin', 'agentId'],
  documentId: ['origin', 'documentId'],
  groupId: ['origin', 'groupId'],
  scope: ['origin', 'scope'],
  sessionId: ['origin', 'sessionId'],
  taskId: ['origin', 'taskId'],
  threadId: ['origin', 'threadId'],
  topicId: ['origin', 'topicId'],
  userId: ['origin', 'userId'],
  workspaceId: ['origin', 'workspaceId'],
  // --- origin: trigger ---
  agentInterventionContinuation: ['origin', 'continuation'],
  agentSignal: ['origin', 'signal'],
  defaultTaskAssigneeAgentId: ['origin', 'defaultTaskAssigneeAgentId'],
  sourceMessageId: ['origin', 'sourceMessageId'],
  trigger: ['origin', 'trigger'],
  // --- origin: run tree ---
  isSubAgent: ['origin', 'lineage', 'isSubAgent'],
  orchestrationRole: ['origin', 'lineage', 'orchestrationRole'],
  subAgentProgress: ['origin', 'lineage', 'progressAnchor'],
  // --- principal ---
  activeDeviceScope: ['principal', 'actor', 'deviceScope'],
  agentShareVisitor: ['principal', 'actor', 'shareVisitor'],
  botContext: ['principal', 'actor', 'bot'],
  clientIp: ['principal', 'audit', 'clientIp'],
  deviceAccessPolicy: ['principal', 'policy', 'deviceAccess'],
  userAgent: ['principal', 'audit', 'userAgent'],
  // --- plan (the model config folds into the top-level slot it duplicated) ---
  evalRuntime: ['plan', 'eval'],
  executionPlan: ['plan', 'execution'],
  modelRuntimeConfig: ['modelRuntimeConfig'],
  operationSkillSet: ['plan', 'skills'],
  stream: ['plan', 'stream'],
  workingDirectory: ['plan', 'workingDirectory'],
  // --- host ---
  _hooks: ['host', 'hooks'],
  queueRetries: ['host', 'queue', 'retries'],
  queueRetryDelay: ['host', 'queue', 'retryDelay'],
  // --- world ---
  agentConfig: ['world', 'agent'],
  agentGroup: ['world', 'group'],
  botPlatformContext: ['world', 'channel', 'botPlatform'],
  connectorOwnershipNote: ['world', 'connectorOwnershipNote'],
  discordContext: ['world', 'channel', 'discord'],
  evalContext: ['world', 'eval'],
  projectInstructions: ['world', 'projectInstructions'],
  searchDecision: ['world', 'searchDecision'],
  userMemory: ['world', 'userMemory'],
  userTimezone: ['world', 'userTimezone'],
  // --- binding ---
  activeDeviceId: ['binding', 'device', 'id'],
  devicePlatform: ['binding', 'device', 'platform'],
  deviceSystemInfo: ['binding', 'device', 'systemInfo'],
};

const LEGACY_KEYS = Object.keys(LEGACY_KEY_PATHS);

const isPresent = (record: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key) &&
  record[key] !== undefined &&
  record[key] !== null;

/**
 * Write `value` at `path` unless something is already there. Clones every
 * object along the path so the input state is never mutated.
 */
const setIfAbsent = (root: Record<string, unknown>, path: readonly string[], value: unknown) => {
  let node = root;
  for (const key of path.slice(0, -1)) {
    const next = node[key];
    const clone = next && typeof next === 'object' ? { ...(next as object) } : {};
    node[key] = clone;
    node = clone as Record<string, unknown>;
  }
  const leaf = path.at(-1)!;
  if (node[leaf] === undefined) node[leaf] = value;
};

/**
 * Lift legacy `metadata.*` run context into the typed slots (`origin`,
 * `principal`, `plan`, `world`, `binding`, `host`) so every reader can rely on
 * the slots alone.
 *
 * Runs at the persistence boundary (state load) for blobs written before the
 * slots existed. Slot values already present win over legacy keys, and the
 * legacy keys are removed from `metadata` so the blob is not carried twice
 * (the in-flight state blob has a hard 10MB ceiling). `null` legacy values
 * are treated as absent: the slots use `undefined` only. Returns the same
 * object when nothing needed lifting.
 */
export const normalizeAgentState = <T extends AgentState>(state: T): T => {
  const metadata = state.metadata;
  if (!metadata || !LEGACY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(metadata, key)))
    return state;

  const next = { ...state } as Record<string, unknown>;
  for (const [legacyKey, path] of Object.entries(LEGACY_KEY_PATHS)) {
    if (isPresent(metadata, legacyKey)) setIfAbsent(next, path, metadata[legacyKey]);
  }

  const strippedMetadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!LEGACY_KEYS.includes(key)) strippedMetadata[key] = value;
  }
  next.metadata = strippedMetadata;

  return next as T;
};

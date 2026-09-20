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

/**
 * Top-level keys that mirrored a slot instead of hiding in `metadata`. The tool
 * set used to be written twice — once as `operationToolSet`, once as these four
 * — which doubled the heaviest part of the blob on every step. They are lifted
 * into the slot and dropped.
 */
const LEGACY_MIRROR_PATHS: Record<string, readonly string[]> = {
  toolExecutorMap: ['operationToolSet', 'executorMap'],
  toolManifestMap: ['operationToolSet', 'manifestMap'],
  toolSourceMap: ['operationToolSet', 'sourceMap'],
  tools: ['operationToolSet', 'tools'],
};

const LEGACY_MIRROR_KEYS = Object.keys(LEGACY_MIRROR_PATHS);

/**
 * An empty mirror carries no tool set, so lifting it would only rewrite the blob
 * for nothing (and would hide a populated slot behind an empty default).
 */
const isPopulatedMirror = (value: unknown) =>
  Array.isArray(value)
    ? value.length > 0
    : !!value && typeof value === 'object' && Object.keys(value).length > 0;

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
 *
 * The run's tool set is lifted the same way, from the four top-level mirrors it
 * used to be written to alongside `operationToolSet` — see
 * {@link LEGACY_MIRROR_PATHS}.
 */
export const normalizeAgentState = <T extends AgentState>(state: T): T => {
  const metadata = state.metadata;
  const hasLegacyMetadata =
    !!metadata && LEGACY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(metadata, key));
  const mirrorKeys = LEGACY_MIRROR_KEYS.filter(
    (key) =>
      isPresent(state as unknown as Record<string, unknown>, key) &&
      isPopulatedMirror((state as unknown as Record<string, unknown>)[key]),
  );
  if (!hasLegacyMetadata && mirrorKeys.length === 0) return state;

  const next = { ...state } as Record<string, unknown>;

  if (metadata && hasLegacyMetadata) {
    for (const [legacyKey, path] of Object.entries(LEGACY_KEY_PATHS)) {
      if (isPresent(metadata, legacyKey)) setIfAbsent(next, path, metadata[legacyKey]);
    }

    const strippedMetadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (!LEGACY_KEYS.includes(key)) strippedMetadata[key] = value;
    }
    next.metadata = strippedMetadata;
  }

  if (mirrorKeys.length > 0) {
    for (const key of mirrorKeys) {
      setIfAbsent(
        next,
        LEGACY_MIRROR_PATHS[key],
        (state as unknown as Record<string, unknown>)[key],
      );
      delete next[key];
    }
    // `setIfAbsent` cloned the slot on the way in, so this default cannot reach
    // the caller's state. A pre-slot blob never had the enabled ids, and the step
    // delta then starts from nothing — how those operations already behaved.
    const toolSet = next.operationToolSet as Record<string, unknown>;
    if (toolSet.enabledToolIds === undefined) toolSet.enabledToolIds = [];
  }

  return next as T;
};

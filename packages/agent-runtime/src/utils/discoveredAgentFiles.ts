import type { AgentState, DiscoveredAgentFiles } from '../types/state';

/**
 * Key under a tool result's `state` where a device file tool reports the agent
 * files it found in a directory the run had not scanned yet.
 */
export const AGENT_FILE_DISCOVERY_STATE_KEY = 'agentFileDiscovery';

const isDiscovery = (value: unknown): value is DiscoveredAgentFiles => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.deviceId === 'string' &&
    Array.isArray(record.dirs) &&
    Array.isArray(record.instructionPaths) &&
    Array.isArray(record.skills)
  );
};

/** The discovery a tool result reported, if any. */
export const readAgentFileDiscovery = (resultState: unknown): DiscoveredAgentFiles | undefined => {
  if (!resultState || typeof resultState !== 'object') return undefined;
  const value = (resultState as Record<string, unknown>)[AGENT_FILE_DISCOVERY_STATE_KEY];
  return isDiscovery(value) ? value : undefined;
};

const union = (left: string[], right: string[]) => [...new Set([...left, ...right])];

/**
 * Fold one tool result's discovery into the run's record. A discovery from
 * another device replaces the record: directories and skill paths name that
 * device's filesystem, so they say nothing about the new one.
 */
export const mergeDiscoveredAgentFiles = (
  current: DiscoveredAgentFiles | undefined,
  next: DiscoveredAgentFiles,
): DiscoveredAgentFiles => {
  if (!current || current.deviceId !== next.deviceId) return next;

  const skillNames = new Set(current.skills.map((skill) => skill.name.toLowerCase()));
  return {
    deviceId: current.deviceId,
    dirs: union(current.dirs, next.dirs),
    instructionPaths: union(current.instructionPaths, next.instructionPaths),
    skills: [
      ...current.skills,
      ...next.skills.filter((skill) => {
        const key = skill.name.toLowerCase();
        if (skillNames.has(key)) return false;
        skillNames.add(key);
        return true;
      }),
    ],
  };
};

/** Record every discovery the step's tool results reported on `state`. */
export const persistAgentFileDiscoveries = (
  state: AgentState,
  resultStates: readonly unknown[],
): void => {
  for (const resultState of resultStates) {
    const discovery = readAgentFileDiscovery(resultState);
    if (!discovery) continue;
    state.discoveredAgentFiles = mergeDiscoveredAgentFiles(state.discoveredAgentFiles, discovery);
  }
};

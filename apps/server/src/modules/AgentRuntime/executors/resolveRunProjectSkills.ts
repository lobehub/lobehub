import path from 'node:path';

import type { AgentState } from '@lobechat/agent-runtime';

import type { RunAgentFiles } from '@/server/services/toolExecution/types';

type RunProjectSkill = {
  description?: string;
  location: string;
  name: string;
  source: 'device' | 'project';
};

/**
 * Project/device filesystem skills (SKILL.md on the execution device) from the
 * operation's skill set, shaped for the tool-execution context. Shared by
 * `callTool` and `callToolsBatch` so batched device `execScript` calls resolve
 * the same SKILL.md cwd as single calls — an unshared copy is exactly how the
 * batch path silently dropped these fields once already.
 *
 * Skills a file tool discovered mid-run on the active device follow the
 * start-of-run ones (see `agentFileDiscovery`), so `activateSkill` and
 * `execScript` can load them even though `<available_skills>` stays fixed for
 * the operation to keep the prompt cache.
 */
export const resolveRunProjectSkills = (
  plan?: {
    skills?: {
      skills?: { description?: string; location?: string; name: string; source?: string }[];
    };
  },
  discovered?: AgentState['discoveredAgentFiles'],
  activeDeviceId?: string,
): RunProjectSkill[] => {
  const fromPlan = (plan?.skills?.skills ?? [])
    .filter(
      (skill) => (skill.source === 'project' || skill.source === 'device') && !!skill.location,
    )
    .map((skill) => ({
      ...(skill.description ? { description: skill.description } : {}),
      location: skill.location as string,
      name: skill.name,
      source: skill.source === 'device' ? ('device' as const) : ('project' as const),
    }));

  if (!discovered || !activeDeviceId || discovered.deviceId !== activeDeviceId) return fromPlan;

  const names = new Set(fromPlan.map((skill) => skill.name.toLowerCase()));
  return [
    ...fromPlan,
    ...discovered.skills
      .filter((skill) => !names.has(skill.name.toLowerCase()))
      .map((skill) => ({
        description: skill.description,
        location: skill.location,
        name: skill.name,
        source: 'project' as const,
      })),
  ];
};

/** The directory an instruction file applies to, in the device's path style. */
const dirOf = (filePath: string) =>
  (/^[A-Za-z]:[\\/]/.test(filePath) ? path.win32 : path.posix).dirname(filePath);

/**
 * What the run already has of the active device's agent files: the bound
 * working directory and the instruction files the start-of-run scan injected,
 * plus everything a file tool discovered since. A mid-run discovery recorded
 * for another device is ignored — its paths name a different filesystem.
 */
export const resolveRunAgentFiles = (
  state: Pick<AgentState, 'binding' | 'discoveredAgentFiles' | 'plan' | 'world'>,
  activeDeviceId: string | undefined,
): RunAgentFiles | undefined => {
  if (!activeDeviceId) return undefined;

  const workingDirectory = state.binding?.device?.systemInfo?.workingDirectory;
  const startPaths = (state.world?.projectInstructions ?? []).flatMap((file) =>
    file.path ? [file.path] : [],
  );
  const discovered =
    state.discoveredAgentFiles?.deviceId === activeDeviceId
      ? state.discoveredAgentFiles
      : undefined;

  return {
    deviceId: activeDeviceId,
    instructionPaths: [...startPaths, ...(discovered?.instructionPaths ?? [])],
    knownDirs: [
      ...new Set([
        ...(workingDirectory ? [workingDirectory] : []),
        ...startPaths.map(dirOf),
        ...(discovered?.dirs ?? []),
      ]),
    ],
    skillNames: [
      ...(state.plan?.skills?.skills ?? []).map((skill) => skill.name),
      ...(discovered?.skills ?? []).map((skill) => skill.name),
    ],
  };
};

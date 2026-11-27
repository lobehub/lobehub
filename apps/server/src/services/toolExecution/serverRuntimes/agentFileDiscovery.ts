import path from 'node:path';

import {
  AGENT_FILE_DISCOVERY_STATE_KEY,
  type PendingAgentFileDiscovery,
} from '@lobechat/agent-runtime';
import { LocalSystemApiName } from '@lobechat/builtin-tool-local-system';
import {
  AGENT_FILE_SCAN_ARG,
  AGENT_FILE_SCAN_STATE_KEY,
  type CommandFileTarget,
  extractCommandFileTargets,
} from '@lobechat/tool-runtime';
import debug from 'debug';

import type { RunAgentFiles } from '../types';

const log = debug('lobe-server:agent-file-discovery');

/**
 * The file tools whose target brings a directory into the run's scope, and the
 * argument naming it. Claude Code loads a subdirectory's agent files on the
 * same trigger: the model reading, writing or editing a file there. Searches
 * are left out — a `grep` over a tree does not say which directory the model
 * is working in. `runCommand` counts through the paths its command reads,
 * writes or `cd`s into (see `extractCommandFileTargets`).
 */
const TARGET_PATH_ARG: Partial<Record<string, 'file_path' | 'path'>> = {
  [LocalSystemApiName.editFile]: 'file_path',
  [LocalSystemApiName.readFile]: 'path',
  [LocalSystemApiName.writeFile]: 'path',
};

/**
 * What the server asks the device for, riding on the tool's args. The device
 * takes the paths from the call itself and bounds each walk by the working
 * directory it was given as `cwd`, or by the target's repository root.
 */
export interface AgentFileScanRequest {
  knownDirs: string[];
}

const pathApiFor = (target: string) =>
  /^[A-Za-z]:[\\/]/.test(target) || target.startsWith('\\\\') ? path.win32 : path.posix;

/** Drop trailing separators, keeping a root (`/`, `C:\\`) whole. */
const trimSeparators = (dir: string) => {
  const trimmed = dir.replace(/[\\/]+$/, '');
  return !trimmed || /^[A-Za-z]:$/.test(trimmed) ? dir : trimmed;
};

/**
 * Whether the directory a target touches was already walked, so the scan can
 * be skipped: the target itself for a `cd`, its parent for a file. Only an
 * exact match counts: a subdirectory of a known directory can still hold its
 * own `AGENTS.md` (a package in a monorepo), which is what discovery is for.
 */
export const isTargetDirKnown = (
  target: string,
  knownDirs: readonly string[],
  kind: CommandFileTarget['kind'] = 'file',
) => {
  const pathApi = pathApiFor(target);
  const dir = kind === 'dir' ? trimSeparators(pathApi.normalize(target)) : pathApi.dirname(target);
  return knownDirs.some((known) => trimSeparators(pathApi.normalize(known)) === dir);
};

/** The paths a call touches: the file tool's argument, or a foreground command's targets. */
const touchedTargets = (
  apiName: string,
  args: Record<string, unknown> | undefined,
): CommandFileTarget[] => {
  if (apiName === LocalSystemApiName.runCommand) {
    // A background command may not have touched anything when the call returns.
    if (args?.run_in_background === true || typeof args?.command !== 'string') return [];
    return extractCommandFileTargets(args.command);
  }
  const arg = TARGET_PATH_ARG[apiName];
  const raw = arg ? args?.[arg] : undefined;
  return typeof raw === 'string' && raw.trim() ? [{ kind: 'file', path: raw }] : [];
};

/**
 * The scan request for a call, or `undefined` when there is nothing to ask:
 * not a file tool or a command touching a path, no working directory, or
 * every directory touched already walked. A target outside the working
 * directory is scanned too — the call only runs once the user allowed it
 * (an approval, or auto-approve), and the rules of the tree it works in are
 * what the model should follow there.
 *
 * This is a pre-filter on the paths as given. A `~/…` path is left to the
 * device, which resolves it like the tool does.
 */
export const buildAgentFileScanRequest = (params: {
  agentFiles: RunAgentFiles | undefined;
  apiName: string;
  args: Record<string, unknown> | undefined;
  workingDirectory: string | undefined;
}): AgentFileScanRequest | undefined => {
  const { agentFiles, apiName, args, workingDirectory } = params;
  if (!agentFiles || !workingDirectory) return undefined;

  const pathApi = pathApiFor(workingDirectory);
  const unknown = touchedTargets(apiName, args).some(
    ({ kind, path: raw }) =>
      raw.startsWith('~') ||
      !isTargetDirKnown(pathApi.resolve(workingDirectory, raw), agentFiles.knownDirs, kind),
  );
  return unknown ? { knownDirs: agentFiles.knownDirs } : undefined;
};

/** Strip a model-supplied scan request: like `cwd`, only the server may set it. */
export const withoutScanRequest = <T extends Record<string, unknown>>(args: T): T => {
  if (!(AGENT_FILE_SCAN_ARG in args)) return args;
  const { [AGENT_FILE_SCAN_ARG]: _offContract, ...rest } = args;
  return rest as T;
};

export const withScanRequest = <T extends Record<string, unknown>>(
  args: T,
  request: AgentFileScanRequest | undefined,
): T => (request ? { ...args, [AGENT_FILE_SCAN_ARG]: request } : args);

interface DeviceScan {
  dirs?: unknown;
  durationMs?: unknown;
  instructions?: { content?: unknown; path?: unknown; source?: unknown }[];
  outcome?: unknown;
  skills?: {
    description?: unknown;
    disableModelInvocation?: unknown;
    name?: unknown;
    path?: unknown;
    scope?: unknown;
  }[];
}

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * Turn the device's answer into what the run has not seen, as a
 * {@link PendingAgentFileDiscovery} the agent runtime renders once the result
 * is final (`applyAgentFileDiscovery`). Instruction files and skill names the
 * run already has are dropped; skills that opt out of model invocation or
 * carry no description stay out, as they do from the start-of-run pool. The
 * raw answer never reaches the stored result.
 */
export const collectAgentFileScan = <T extends { state?: unknown; success?: boolean }>(
  result: T,
  context: { deviceId: string; requested: boolean; run: RunAgentFiles },
): T => {
  const state =
    result.state && typeof result.state === 'object'
      ? (result.state as Record<string, unknown>)
      : undefined;
  const scan = state?.[AGENT_FILE_SCAN_STATE_KEY] as DeviceScan | undefined;
  if (!state || !(AGENT_FILE_SCAN_STATE_KEY in state)) {
    if (context.requested && result.success) {
      // The device ran the tool but did not answer: a client that predates
      // the scan, which ignores the arg.
      log('scan outcome=unsupported device=%s', context.deviceId);
    }
    return result;
  }

  const { [AGENT_FILE_SCAN_STATE_KEY]: _raw, ...rest } = state;
  const stripped = { ...result, state: rest };
  if (!context.requested || !scan || typeof scan !== 'object') return stripped;

  const dirs = strings(scan.dirs);
  log(
    'scan outcome=%s device=%s dirs=%d durationMs=%s',
    scan.outcome,
    context.deviceId,
    dirs.length,
    scan.durationMs,
  );
  if (dirs.length === 0) return stripped;

  const knownPaths = new Set(context.run.instructionPaths);
  const knownSkills = new Set(context.run.skillNames.map((name) => name.toLowerCase()));
  const disabledSkills = new Set(context.run.disabledSkillIds);

  const instructions = (scan.instructions ?? []).flatMap((item) =>
    typeof item.path === 'string' && typeof item.content === 'string' && !knownPaths.has(item.path)
      ? [
          {
            content: item.content,
            path: item.path,
            source: typeof item.source === 'string' ? item.source : 'AGENTS.md',
          },
        ]
      : [],
  );
  const skills = (scan.skills ?? []).flatMap((skill) => {
    const description = typeof skill.description === 'string' ? skill.description.trim() : '';
    if (typeof skill.name !== 'string' || typeof skill.path !== 'string' || !description) return [];
    if (skill.scope === 'device' || skill.disableModelInvocation === true) return [];
    // The id the skill pool and `activateSkill` gate a filesystem skill by.
    if (disabledSkills.has(`project:${skill.name}`)) return [];
    const key = skill.name.toLowerCase();
    if (knownSkills.has(key)) return [];
    knownSkills.add(key);
    return [{ description, location: skill.path, name: skill.name }];
  });

  const pending: PendingAgentFileDiscovery = {
    deviceId: context.deviceId,
    dirs,
    instructions,
    skills,
  };
  return { ...stripped, state: { ...rest, [AGENT_FILE_DISCOVERY_STATE_KEY]: pending } };
};

import path from 'node:path';

import {
  AGENT_FILE_DISCOVERY_STATE_KEY,
  type PendingAgentFileDiscovery,
} from '@lobechat/agent-runtime';
import { LocalSystemApiName } from '@lobechat/builtin-tool-local-system';
import { AGENT_FILE_SCAN_ARG, AGENT_FILE_SCAN_STATE_KEY } from '@lobechat/tool-runtime';
import debug from 'debug';

import type { RunAgentFiles } from '../types';

const log = debug('lobe-server:agent-file-discovery');

/**
 * The file tools whose target brings a directory into the run's scope, and the
 * argument naming it. Claude Code loads a subdirectory's agent files on the
 * same trigger: the model reading, writing or editing a file there. Searches
 * and commands are left out — a `grep` over a tree or a `cd` in a command does
 * not say which directory the model is working in.
 */
const TARGET_PATH_ARG: Partial<Record<string, 'file_path' | 'path'>> = {
  [LocalSystemApiName.editFile]: 'file_path',
  [LocalSystemApiName.readFile]: 'path',
  [LocalSystemApiName.writeFile]: 'path',
};

/**
 * What the server asks the device for, riding on the file tool's args. The
 * device bounds the scan by the working directory it was given as `cwd`.
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
 * Whether the directory holding `target` was already walked, so the scan can
 * be skipped. Only an exact match counts: a subdirectory of a known directory
 * can still hold its own `AGENTS.md` (a package in a monorepo), which is what
 * discovery is for.
 */
export const isTargetDirKnown = (target: string, knownDirs: readonly string[]) => {
  const pathApi = pathApiFor(target);
  const dir = pathApi.dirname(target);
  return knownDirs.some((known) => trimSeparators(pathApi.normalize(known)) === dir);
};

/**
 * The scan request for a file tool call, or `undefined` when there is nothing
 * to ask: not a file tool, no working directory, a target outside it, or a
 * directory already walked. Discovery never leaves the working directory —
 * approving one file elsewhere does not approve reading that tree's agent
 * files (Claude Code does not load them either).
 *
 * This is a pre-filter on the path as given. A `~/…` path is left to the
 * device, which resolves it like the file tool and checks the real path
 * against the working directory itself.
 */
export const buildAgentFileScanRequest = (params: {
  agentFiles: RunAgentFiles | undefined;
  apiName: string;
  args: Record<string, unknown> | undefined;
  workingDirectory: string | undefined;
}): AgentFileScanRequest | undefined => {
  const { agentFiles, apiName, args, workingDirectory } = params;
  const arg = TARGET_PATH_ARG[apiName];
  const raw = arg ? args?.[arg] : undefined;
  if (!agentFiles || !workingDirectory || typeof raw !== 'string' || !raw.trim()) return undefined;

  const request = { knownDirs: agentFiles.knownDirs };
  if (raw.startsWith('~')) return request;

  const pathApi = pathApiFor(workingDirectory);
  const target = pathApi.resolve(workingDirectory, raw);
  const relative = pathApi.relative(trimSeparators(pathApi.normalize(workingDirectory)), target);
  if (relative.startsWith('..') || pathApi.isAbsolute(relative)) return undefined;
  if (isTargetDirKnown(target, agentFiles.knownDirs)) return undefined;

  return request;
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

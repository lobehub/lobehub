import path from 'node:path';

import { AGENT_FILE_DISCOVERY_STATE_KEY, type DiscoveredAgentFiles } from '@lobechat/agent-runtime';
import { LocalSystemApiName } from '@lobechat/builtin-tool-local-system';
import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { deviceGateway } from '@/server/services/deviceGateway';
import { resolveDeviceDispatchAuthorizationFailure } from '@/server/services/deviceGateway/dispatchAuthorization';
import type { AgentFileDiscoveryResult } from '@/server/services/deviceGateway/workspace';

import type { RunAgentFiles } from '../types';

const log = debug('lobe-server:agent-file-discovery');

/**
 * The file tools whose target brings a directory into the run's scope, and the
 * argument naming it. Claude Code and OpenCode load a directory's agent files
 * on the same trigger: the model reading, writing or editing a file there.
 * Searches and commands are left out — a `grep` over a tree or a `cd` in a
 * command does not say which directory the model is working in.
 */
const TARGET_PATH_ARG: Partial<Record<string, 'file_path' | 'path'>> = {
  [LocalSystemApiName.editFile]: 'file_path',
  [LocalSystemApiName.readFile]: 'path',
  [LocalSystemApiName.writeFile]: 'path',
};

/**
 * Character budget for the instructions one discovery shows the model. The
 * block leads the tool result so the result's own truncation (which keeps the
 * leading window) never cuts it; the budget keeps it from crowding out the
 * file the model asked for.
 */
const MAX_INJECTED_INSTRUCTION_CHARS = 16_000;

const pathApiFor = (target: string) =>
  /^[A-Za-z]:[\\/]/.test(target) || target.startsWith('\\\\') ? path.win32 : path.posix;

/**
 * The absolute path a file tool call targets, or `undefined` for other calls.
 * A relative path resolves against the working directory, as the device does.
 */
export const resolveToolTargetPath = (
  apiName: string,
  args: Record<string, unknown> | undefined,
  workingDirectory: string | undefined,
): string | undefined => {
  const arg = TARGET_PATH_ARG[apiName];
  const raw = arg ? args?.[arg] : undefined;
  if (typeof raw !== 'string' || !raw.trim()) return undefined;

  const pathApi = pathApiFor(workingDirectory || raw);
  if (pathApi.isAbsolute(raw)) return pathApi.normalize(raw);
  return workingDirectory ? pathApi.resolve(workingDirectory, raw) : undefined;
};

/**
 * Whether the directory holding `target` was already walked, so the device
 * round-trip can be skipped. Only an exact match counts: a subdirectory of a
 * known directory can still hold its own `AGENTS.md` (a package in a
 * monorepo), which is what discovery is for.
 */
export const isTargetDirKnown = (target: string, knownDirs: readonly string[]) => {
  const pathApi = pathApiFor(target);
  const dir = pathApi.dirname(target);
  return knownDirs.some((known) => {
    const normalized = pathApi.normalize(known).replace(/[\\/]+$/, '') || known;
    return normalized === dir;
  });
};

/**
 * Ask the device for the agent files around a file tool's target, or return
 * `undefined` when the call is not a file tool, its directory was already
 * walked, or the run carries no record to compare against. Never rejects: a
 * failed discovery resolves to `undefined` and the tool result goes out as is.
 *
 * Reading the device is new work dispatched to it, so it passes the same
 * last-moment registry check as the tool call (`executeAuthorizedDeviceToolCall`):
 * a workspace device unshared mid-run must not have its files read.
 */
export const startAgentFileDiscovery = (params: {
  agentFiles: RunAgentFiles | undefined;
  apiName: string;
  args: Record<string, unknown> | undefined;
  deviceId: string;
  getWorkspaceId: () => Promise<string | undefined>;
  serverDB: LobeChatDatabase | undefined;
  userId: string;
  workingDirectory: string | undefined;
}): Promise<AgentFileDiscoveryResult | undefined> | undefined => {
  const {
    agentFiles,
    apiName,
    args,
    deviceId,
    getWorkspaceId,
    serverDB,
    userId,
    workingDirectory,
  } = params;
  if (!agentFiles) return undefined;

  const target = resolveToolTargetPath(apiName, args, workingDirectory);
  if (!target || isTargetDirKnown(target, agentFiles.knownDirs)) return undefined;

  return (async () => {
    try {
      const workspaceId = await getWorkspaceId();
      const denied = await resolveDeviceDispatchAuthorizationFailure(
        serverDB,
        userId,
        deviceId,
        workspaceId,
      );
      if (denied) return undefined;

      return await deviceGateway.discoverAgentFiles({
        deviceId,
        knownDirs: agentFiles.knownDirs,
        path: target,
        userId,
        workspaceId,
      });
    } catch (error) {
      log('discovery failed for %s: %O', target, error);
      return undefined;
    }
  })();
};

/**
 * In-process claims per operation: the calls of one batch run concurrently
 * from the same pre-batch state, so without this two reads in a new repository
 * would both show its `AGENTS.md`. State persistence covers later steps.
 */
const claims = new Map<string, { at: number; keys: Set<string> }>();
const CLAIM_TTL_MS = 10 * 60_000;

const claim = (operationId: string | undefined, key: string): boolean => {
  if (!operationId) return true;
  const now = Date.now();
  for (const [id, entry] of claims) if (now - entry.at > CLAIM_TTL_MS) claims.delete(id);

  const entry = claims.get(operationId) ?? { at: now, keys: new Set<string>() };
  claims.set(operationId, entry);
  entry.at = now;
  if (entry.keys.has(key)) return false;
  entry.keys.add(key);
  return true;
};

const escapeAttr = (value: string) => value.replaceAll('"', '&quot;');

const renderDiscovery = (
  instructions: AgentFileDiscoveryResult['instructions'],
  skills: DiscoveredAgentFiles['skills'],
): string => {
  const parts: string[] = [
    '<agent_files_discovered>',
    'This directory has agent files the run had not loaded yet. Follow these instructions for work under their directory, together with the ones you started with; the more specific file wins where they disagree.',
  ];

  // The device lists files root first, which is also the reading order. The
  // budget is spent the other way: the file nearest the target is the most
  // specific and wins on conflict, so a long repository-root file must not
  // crowd it out.
  let remaining = MAX_INJECTED_INSTRUCTION_CHARS;
  const shownLengths = new Map<number, number>();
  for (let index = instructions.length - 1; index >= 0; index--) {
    const length = Math.min(instructions[index].content.length, remaining);
    shownLengths.set(index, length);
    remaining -= length;
  }

  for (const [index, { content, path: filePath, source }] of instructions.entries()) {
    const attrs = `source="${source}"${filePath ? ` path="${escapeAttr(filePath)}"` : ''}`;
    const shown = content.slice(0, shownLengths.get(index) ?? 0);
    const fits = shown.length === content.length;
    const note = fits
      ? ''
      : `\n[Truncated to fit this tool result. Read ${filePath ?? source} for the rest.]`;
    parts.push(`<project_instructions ${attrs}>\n${shown}${note}\n</project_instructions>`);
  }

  if (skills.length > 0) {
    parts.push(
      'Skills available under this directory (load one with activateSkill by name, or read its SKILL.md):',
      ...skills.map(({ description, location, name }) => `- ${name}: ${description} (${location})`),
    );
  }

  parts.push('</agent_files_discovered>');
  return parts.join('\n');
};

/**
 * Turn the device's answer into what the run has not seen: instruction files
 * and skill names already in the run (or claimed by a concurrent call in this
 * batch) are dropped. Skills that opt out of model invocation or carry no
 * description stay out, as they do from the start-of-run pool.
 */
export const selectNewAgentFiles = (
  discovery: AgentFileDiscoveryResult,
  run: RunAgentFiles,
  operationId?: string,
) => {
  const knownPaths = new Set(run.instructionPaths);
  const knownSkills = new Set(run.skillNames.map((name) => name.toLowerCase()));

  const instructions = discovery.instructions.filter(
    (item) =>
      !!item.path && !knownPaths.has(item.path) && claim(operationId, `instruction:${item.path}`),
  );
  const skills = discovery.skills
    .filter((skill) => skill.scope !== 'device' && !skill.disableModelInvocation)
    .flatMap((skill) => {
      const description = skill.description?.trim();
      const key = skill.name.toLowerCase();
      if (!description || knownSkills.has(key)) return [];
      if (!claim(operationId, `skill:${key}`)) return [];
      knownSkills.add(key);
      return [{ description, location: skill.path, name: skill.name }];
    });

  return { instructions, skills };
};

/**
 * Attach a discovery to a successful file tool result: the new instructions
 * and skills lead the content, and the result's `state` carries the record the
 * agent runtime folds into `state.discoveredAgentFiles`. The directories are
 * recorded even when they held nothing new, so the next call there skips the
 * device round-trip.
 */
export const applyAgentFileDiscovery = <
  T extends { content?: unknown; state?: unknown; success?: boolean },
>(
  result: T,
  discovery: AgentFileDiscoveryResult | undefined,
  context: { deviceId: string; operationId?: string; run: RunAgentFiles },
): T => {
  if (!result.success || !discovery || discovery.dirs.length === 0) return result;

  const { instructions, skills } = selectNewAgentFiles(discovery, context.run, context.operationId);
  const record: DiscoveredAgentFiles = {
    deviceId: context.deviceId,
    dirs: discovery.dirs,
    instructionPaths: instructions.map((item) => item.path!),
    skills,
  };
  const state = {
    ...(result.state && typeof result.state === 'object' ? result.state : {}),
    [AGENT_FILE_DISCOVERY_STATE_KEY]: record,
  };

  if (instructions.length === 0 && skills.length === 0) return { ...result, state };

  log(
    'discovered %d instruction file(s) and %d skill(s) under %s',
    instructions.length,
    skills.length,
    discovery.dirs.at(-1),
  );
  const block = renderDiscovery(instructions, skills);
  const content = typeof result.content === 'string' ? result.content : '';
  return { ...result, content: content ? `${block}\n\n${content}` : block, state };
};

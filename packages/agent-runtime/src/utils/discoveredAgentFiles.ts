import type { AgentState, DiscoveredAgentFiles, DiscoveredAgentSkill } from '../types/state';

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

/** One instruction file a discovery found, still carrying its text. */
export interface PendingAgentInstruction {
  content: string;
  path: string;
  source: string;
}

/**
 * What a device file tool reports under {@link AGENT_FILE_DISCOVERY_STATE_KEY}
 * before the runtime shows it: the host has already dropped what the run had
 * at its start or from earlier steps. {@link applyAgentFileDiscovery} renders
 * it into the tool content and leaves a {@link DiscoveredAgentFiles} record.
 */
export interface PendingAgentFileDiscovery {
  deviceId: string;
  dirs: string[];
  instructions: PendingAgentInstruction[];
  skills: DiscoveredAgentSkill[];
}

/**
 * Character budget for the instructions one discovery shows the model. The
 * block leads the tool result so the result's own truncation (which keeps the
 * leading window) never cuts it; the budget keeps it from crowding out the
 * file the model asked for.
 */
const MAX_INJECTED_INSTRUCTION_CHARS = 16_000;

const isPending = (value: unknown): value is PendingAgentFileDiscovery => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.deviceId === 'string' &&
    Array.isArray(record.dirs) &&
    Array.isArray(record.instructions) &&
    Array.isArray(record.skills)
  );
};

/**
 * What the calls of one tool batch have shown so far. The calls run
 * concurrently from the same pre-batch state, so without it two reads in a new
 * package would both carry its `AGENTS.md`. Scoped to one executor call, so a
 * redelivered step starts clean instead of finding its own claims.
 */
export interface AgentFileBatchSeen {
  instructionPaths: Set<string>;
  skillNames: Set<string>;
}

export const createAgentFileBatchSeen = (): AgentFileBatchSeen => ({
  instructionPaths: new Set(),
  skillNames: new Set(),
});

const escapeAttr = (value: string) => value.replaceAll('"', '&quot;');

const renderDiscovery = (
  instructions: PendingAgentInstruction[],
  skills: DiscoveredAgentSkill[],
  skillsToolAvailable: boolean,
): string => {
  const parts: string[] = [
    '<agent_files_discovered>',
    'This directory has agent files the run had not loaded yet. Follow these instructions for work under their directory, together with the ones you started with; the more specific file wins where they disagree.',
  ];

  // Files come root first, which is also the reading order. The budget is
  // spent the other way: the file nearest the target is the most specific and
  // wins on conflict, so a long parent file must not crowd it out.
  let remaining = MAX_INJECTED_INSTRUCTION_CHARS;
  const shownLengths = new Map<number, number>();
  for (let index = instructions.length - 1; index >= 0; index--) {
    const length = Math.min(instructions[index].content.length, remaining);
    shownLengths.set(index, length);
    remaining -= length;
  }

  for (const [index, { content, path: filePath, source }] of instructions.entries()) {
    const shown = content.slice(0, shownLengths.get(index) ?? 0);
    const note =
      shown.length === content.length
        ? ''
        : `\n[Truncated to fit this tool result. Read ${filePath} for the rest.]`;
    parts.push(
      `<project_instructions source="${escapeAttr(source)}" path="${escapeAttr(filePath)}">\n${shown}${note}\n</project_instructions>`,
    );
  }

  if (skills.length > 0) {
    // A run that started without skills has no `activateSkill` yet, and
    // adding it mid-run would change the tool list the prompt cache keys on.
    // Reading SKILL.md with the file tool that found it works either way.
    parts.push(
      skillsToolAvailable
        ? 'Skills available under this directory (load one with activateSkill by name, or read its SKILL.md):'
        : 'Skills available under this directory (to use one, read its SKILL.md and follow it):',
      ...skills.map(({ description, location, name }) => `- ${name}: ${description} (${location})`),
    );
  }

  parts.push('</agent_files_discovered>');
  return parts.join('\n');
};

/**
 * Show a device file tool's discovery to the model: what this batch has not
 * shown yet leads the tool content, and the result's `state` keeps a
 * {@link DiscoveredAgentFiles} record (paths only) for
 * {@link persistAgentFileDiscoveries}. Runs once the result is final and
 * before it is published or persisted, so a blocked or failed call never
 * claims anything. The directories are recorded even when nothing in them was
 * new, so the next call there skips the scan.
 */
export const applyAgentFileDiscovery = <
  T extends { content?: unknown; state?: Record<string, any>; success?: boolean },
>(
  result: T,
  options: { blocked?: boolean; seen: AgentFileBatchSeen; skillsToolAvailable: boolean },
): T => {
  const pending = result.state?.[AGENT_FILE_DISCOVERY_STATE_KEY];
  if (!isPending(pending)) return result;

  const { [AGENT_FILE_DISCOVERY_STATE_KEY]: _pending, ...rest } = result.state!;
  if (!result.success || options.blocked || pending.dirs.length === 0) {
    return { ...result, state: rest };
  }

  const { seen } = options;
  const instructions = pending.instructions.filter((item) => {
    if (seen.instructionPaths.has(item.path)) return false;
    seen.instructionPaths.add(item.path);
    return true;
  });
  const skills = pending.skills.filter((skill) => {
    const key = skill.name.toLowerCase();
    if (seen.skillNames.has(key)) return false;
    seen.skillNames.add(key);
    return true;
  });

  const record: DiscoveredAgentFiles = {
    deviceId: pending.deviceId,
    dirs: pending.dirs,
    instructionPaths: instructions.map((item) => item.path),
    skills,
  };
  const state = { ...rest, [AGENT_FILE_DISCOVERY_STATE_KEY]: record };
  if (instructions.length === 0 && skills.length === 0) return { ...result, state };

  const block = renderDiscovery(instructions, skills, options.skillsToolAvailable);
  const content = typeof result.content === 'string' ? result.content : '';
  return { ...result, content: content ? `${block}\n\n${content}` : block, state };
};

/** Whether this step's tools include `lobe-skills`, which owns `activateSkill`. */
export const hasSkillsTool = (manifestMap: Record<string, unknown> | undefined): boolean =>
  !!manifestMap && 'lobe-skills' in manifestMap;

/**
 * The result as the model will see it, for the host's `afterToolCall` control
 * hooks and observers: the discovery block rendered into the content, and the
 * pending payload (full instruction text) dropped from the state. Rendered
 * without batch dedupe, so a hook reviews everything the model could be shown.
 * The run still renders the real block itself, with {@link applyAgentFileDiscovery},
 * once the hooks have let the result through.
 */
export const previewAgentFileDiscovery = <
  T extends { content?: unknown; state?: Record<string, any>; success?: boolean },
>(
  result: T,
  options: { skillsToolAvailable: boolean },
): T => {
  if (!isPending(result.state?.[AGENT_FILE_DISCOVERY_STATE_KEY])) return result;

  const applied = applyAgentFileDiscovery(result, {
    seen: createAgentFileBatchSeen(),
    skillsToolAvailable: options.skillsToolAvailable,
  });
  const { [AGENT_FILE_DISCOVERY_STATE_KEY]: _record, ...state } = applied.state ?? {};
  return { ...applied, state };
};

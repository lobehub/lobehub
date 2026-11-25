import { type SkillItem, type SkillSource, skillsPrompts } from '@lobechat/prompts';
import { isPlainRecord } from '@lobechat/utils/object';
import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { Message, PipelineContext, ProcessorOptions } from '../types';
import { SKILL_STORE_TOOL_ID } from './SkillImportRouteInjector';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    skillContext?: {
      injected: boolean;
      skillsCount: number;
    };
  }
}

const log = debug('context-engine:provider:SkillContextProvider');

/** Skill Store APIs whose result reports the import `status` in its state. */
const SKILL_STORE_IMPORT_APIS = new Set(['importFromMarket', 'importSkill']);

/**
 * Filesystem skills outrank a user-library skill of the same name in the skill
 * pool, so a listed entry with one of these sources is never the library skill
 * an import just created.
 */
const FILESYSTEM_SKILL_SOURCES = new Set<SkillSource | undefined>(['device', 'project']);

const extractCreatedSkillName = (state: unknown): string | undefined => {
  if (!isPlainRecord(state)) return undefined;
  if (state.success !== true || state.status !== 'created') return undefined;

  return typeof state.name === 'string' && state.name ? state.name : undefined;
};

/**
 * Collect the names of skills created by `lobe-skill-store` in the visible
 * (non-truncated, non-compressed) conversation history.
 *
 * When the model installs a new skill mid-conversation, listing it in
 * `<available_skills>` on the next turn mutates message `[0]` and invalidates
 * the provider prompt cache for the whole conversation prefix. Until the import
 * turn leaves visible history, the model knows the skill only from the import
 * confirmation, which carries its name and not its description.
 *
 * Names are compared exactly, the way the skill pool dedupes them.
 *
 * Deliberately skips `compressedGroup.compressedMessages`: once the import turn
 * is compressed into a summary or truncated out of history, the skill returns
 * to `<available_skills>` so the model never loses visibility of it. Also
 * ignores `status: 'updated' | 'unchanged'` because those skills were already
 * in the initial `<available_skills>` block and removing them would itself
 * break the cached prefix.
 *
 * Covers model-driven Skill Store installs only, because they are the only
 * list change the history records. A re-import that reorders the list, a skill
 * created by `lobe-skill-maintainer`, and an install made outside the
 * conversation still change message `[0]` on the next turn.
 */
const collectSessionCreatedSkillNames = (messages: readonly Message[]): Set<string> => {
  const names = new Set<string>();

  for (const msg of messages) {
    if (
      msg.role === 'tool' &&
      isPlainRecord(msg.plugin) &&
      msg.plugin.identifier === SKILL_STORE_TOOL_ID &&
      typeof msg.plugin.apiName === 'string' &&
      SKILL_STORE_IMPORT_APIS.has(msg.plugin.apiName)
    ) {
      const name = extractCreatedSkillName(msg.pluginState);
      if (name) names.add(name);
      continue;
    }

    if (!Array.isArray(msg.children)) continue;

    for (const child of msg.children) {
      if (!isPlainRecord(child) || !Array.isArray(child.tools)) continue;

      for (const tool of child.tools) {
        if (
          !isPlainRecord(tool) ||
          tool.identifier !== SKILL_STORE_TOOL_ID ||
          typeof tool.apiName !== 'string' ||
          !SKILL_STORE_IMPORT_APIS.has(tool.apiName)
        ) {
          continue;
        }

        const result = isPlainRecord(tool.result) ? tool.result : undefined;
        const name = extractCreatedSkillName(result?.state);
        if (name) names.add(name);
      }
    }
  }

  return names;
};

/**
 * Lightweight skill metadata for context injection
 * Compatible with the SkillMeta that will be added in @lobechat/types (Phase 3.2)
 */
export interface SkillMeta {
  /**
   * When true, the skill's content is directly injected into the system prompt
   * instead of only appearing in the <available_skills> list.
   */
  activated?: boolean;
  /**
   * Full skill content to inject when activated.
   * Only used when `activated` is true.
   */
  content?: string;
  description: string;
  identifier: string;
  location?: string;
  name: string;
  /**
   * Skill origin. `project` and `device` skills are discovered on the device
   * filesystem and loaded on demand via `activateSkill` (`location` gives their
   * absolute SKILL.md path).
   */
  source?: SkillSource;
}

/**
 * Skill Context Provider Configuration
 */
export interface SkillContextProviderConfig {
  /**
   * Whether the run was sent the `activateSkill` tool. Without it the prompt
   * keeps the readFile route into filesystem skills. Defaults to true.
   */
  canActivateSkill?: boolean;
  enabled?: boolean;
  enabledSkills?: SkillMeta[];
}

/**
 * Select the activated skills whose full content gets injected into the system
 * prompt by SkillContextProvider.
 *
 * Exported so ActivationResultTrimProcessor can decide, with the exact same
 * predicate, whether an activateSkill tool result's full content is already
 * carried by the system prompt and can therefore be trimmed from history.
 */
export const selectActivatedSkills = (enabledSkills?: SkillMeta[]): SkillMeta[] =>
  (enabledSkills ?? []).filter((s) => s.activated && s.content);

/**
 * Skill Context Provider
 * Injects lightweight skill metadata into the system prompt so the LLM knows
 * which skills are available and can invoke them via `activateSkill`.
 */
export class SkillContextProvider extends BaseSystemRoleProvider {
  readonly name = 'SkillContextProvider';

  /** Skills the last `buildSystemRoleContent` call put into the prompt. */
  private injectedSkillsCount = 0;

  constructor(
    private config: SkillContextProviderConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  private resolvePromptSkills(context: PipelineContext) {
    const enabledSkills = this.config.enabledSkills ?? [];
    const activatedSkills = selectActivatedSkills(enabledSkills);
    const sessionCreatedSkillNames = collectSessionCreatedSkillNames(context.messages);
    const availableSkills = enabledSkills.filter(
      (s) =>
        !s.activated &&
        (FILESYSTEM_SKILL_SOURCES.has(s.source) || !sessionCreatedSkillNames.has(s.name)),
    );

    return { activatedSkills, availableSkills };
  }

  protected buildSystemRoleContent(context: PipelineContext): string | null {
    if (this.config.enabled === false) return null;

    const { enabledSkills } = this.config;

    if (!enabledSkills || enabledSkills.length === 0) {
      log('No enabled skills, skipping injection');
      return null;
    }

    // Separate activated skills (inject content directly) from available skills (list only),
    // keeping skills created inside this conversation out of <available_skills> so the
    // leading system message stays byte-stable for prompt caching.
    const { activatedSkills, availableSkills } = this.resolvePromptSkills(context);

    const contentParts: string[] = [];

    // Inject activated skill content directly into system prompt
    for (const skill of activatedSkills) {
      contentParts.push(skill.content!);
      log('Auto-activated skill: %s', skill.identifier);
    }

    // Generate <available_skills> list for non-activated skills
    if (availableSkills.length > 0) {
      const skills: SkillItem[] = availableSkills.map((skill) => ({
        description: skill.description,
        identifier: skill.identifier,
        location: skill.location,
        name: skill.name,
        source: skill.source,
      }));

      const availableSkillsContent = skillsPrompts(skills, {
        canActivateSkill: this.config.canActivateSkill,
      });
      if (availableSkillsContent) {
        contentParts.push(availableSkillsContent);
      }
    }

    if (contentParts.length === 0) {
      log('No skill content generated, skipping injection');
      return null;
    }

    log(
      'Skill context prepared: %d activated, %d available',
      activatedSkills.length,
      availableSkills.length,
    );
    this.injectedSkillsCount = activatedSkills.length + availableSkills.length;
    return contentParts.join('\n\n');
  }

  protected onInjected(context: PipelineContext): void {
    context.metadata.skillContext = {
      injected: true,
      skillsCount: this.injectedSkillsCount,
    };
  }
}

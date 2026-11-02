import {
  escapeXmlAttr,
  escapeXmlContent,
  type SkillItem,
  type SkillSource,
  skillsPrompts,
} from '@lobechat/prompts';
import type { AgentContextMode, SkillResourceMeta } from '@lobechat/types';
import debug from 'debug';
import { estimateTokenCount } from 'tokenx';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    skillContext?: {
      injected: boolean;
      skillsCount: number;
    };
  }
}

const log = debug('context-engine:provider:SkillContextProvider');

export const ON_DEMAND_SKILL_CARD_RELEVANCE = 0.85;

const toPromptSkillSource = (source: SkillMeta['source']): SkillSource | undefined =>
  source === 'agent' || source === 'market' ? undefined : source;

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
  /** Structured resources used to emit reference cards without loading bodies. */
  resources?: Record<string, SkillResourceMeta>;
  /**
   * Skill origin. `project` skills are discovered on the device filesystem and
   * loaded on demand via the readFile tool (see `location`).
   */
  source?: SkillSource | 'agent' | 'market';
}

/**
 * Skill Context Provider Configuration
 */
export interface SkillContextProviderConfig {
  /**
   * On-demand keeps all skill content out of the system prompt. Discovery cards
   * are produced for the dynamic suffix instead.
   */
  contextMode?: AgentContextMode;
  enabled?: boolean;
  enabledSkills?: SkillMeta[];
  /** 'lean' truncates skill descriptions to one-line gists. Undefined/'full' = legacy. */
  promptMode?: 'full' | 'lean';
}

export interface OnDemandSkillCard {
  readonly description: string;
  /** Estimated body cost, not the cost of this compact card. */
  readonly estimatedTokens: number;
  readonly identifier: string;
  readonly location?: string;
  readonly name: string;
  readonly relevance: number;
  readonly source: SkillSource | 'agent' | 'market';
}

export interface OnDemandSkillReferenceCard {
  readonly path: string;
  readonly size?: number;
  readonly skillIdentifier: string;
  readonly skillName: string;
  readonly sourceVersion?: string;
}

const normalize = (value: string) => value.toLocaleLowerCase();

const queryTerms = (message: string): string[] => {
  const normalized = normalize(message);
  const latinTerms = normalized.match(/[a-z0-9][a-z0-9_-]+/g) ?? [];
  const cjkTerms = normalized.match(/\p{Script=Han}{2,}/gu) ?? [];

  return [...new Set([...latinTerms, ...cjkTerms])];
};

export const scoreOnDemandSkillRelevance = (
  skill: Pick<SkillMeta, 'description' | 'identifier' | 'name'>,
  currentUserMessage: string,
): number => {
  const normalizedMessage = normalize(currentUserMessage);
  if (
    normalizedMessage.includes(normalize(skill.identifier)) ||
    normalizedMessage.includes(normalize(skill.name))
  ) {
    return 0.95;
  }

  const searchable = normalize(`${skill.name} ${skill.description}`);
  return queryTerms(currentUserMessage).some((term) => searchable.includes(term)) ? 0.9 : 0.2;
};

/**
 * Builds card-only skill discovery data. Bodies and reference bodies remain
 * absent; only stable identity and the possible load cost are exposed.
 */
export const buildOnDemandSkillCards = (
  enabledSkills: readonly SkillMeta[] = [],
  currentUserMessage = '',
): OnDemandSkillCard[] =>
  enabledSkills.map((skill) => ({
    description: skill.description,
    estimatedTokens: estimateTokenCount(skill.content ?? skill.description),
    identifier: skill.identifier,
    ...(skill.location && { location: skill.location }),
    name: skill.name,
    relevance: scoreOnDemandSkillRelevance(skill, currentUserMessage),
    source: skill.source ?? 'builtin',
  }));

export const selectOnDemandSkillCards = (
  enabledSkills: readonly SkillMeta[] = [],
  currentUserMessage = '',
): OnDemandSkillCard[] =>
  buildOnDemandSkillCards(enabledSkills, currentUserMessage).filter(
    (card) => card.relevance >= ON_DEMAND_SKILL_CARD_RELEVANCE,
  );

const renderAttributes = (attributes: Readonly<Record<string, string | number>>): string =>
  Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${escapeXmlAttr(String(value))}"`)
    .join('');

export const renderOnDemandSkillCard = (card: OnDemandSkillCard): string =>
  [
    `<skill_card${renderAttributes({
      estimated_tokens: card.estimatedTokens,
      identifier: card.identifier,
      ...(card.location && { location: card.location }),
      name: card.name,
      source: card.source,
    })}>`,
    escapeXmlContent(card.description),
    '</skill_card>',
  ].join('\n');

export const buildOnDemandSkillReferenceCards = (skill: {
  identifier: string;
  name: string;
  resources?: Record<string, SkillResourceMeta>;
}): OnDemandSkillReferenceCard[] =>
  Object.entries(skill.resources ?? {})
    .map(([path, meta]) => ({
      path,
      ...(meta.fileHash && { sourceVersion: meta.fileHash }),
      ...(typeof meta.size === 'number' && { size: meta.size }),
      skillIdentifier: skill.identifier,
      skillName: skill.name,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

export const renderOnDemandSkillReferenceCard = (card: OnDemandSkillReferenceCard): string =>
  [
    `<skill_reference_card${renderAttributes({
      path: card.path,
      skill: card.skillIdentifier,
      ...(card.sourceVersion && { version: card.sourceVersion }),
      ...(card.size !== undefined && { size: card.size }),
    })}>`,
    escapeXmlContent(
      `Reference for ${card.skillName}. Load with readReference({ id: "${card.skillIdentifier}", path: "${card.path}" }).`,
    ),
    '</skill_reference_card>',
  ].join('\n');

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
 * which skills are available and can invoke them via `runSkill`.
 */
export class SkillContextProvider extends BaseSystemRoleProvider {
  readonly name = 'SkillContextProvider';

  constructor(
    private config: SkillContextProviderConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.contextMode === 'on-demand') {
      log('On-demand mode keeps skill content out of the system prompt');
      return null;
    }

    if (this.config.enabled === false) return null;

    const { enabledSkills } = this.config;

    if (!enabledSkills || enabledSkills.length === 0) {
      log('No enabled skills, skipping injection');
      return null;
    }

    // Separate activated skills (inject content directly) from available skills (list only)
    const activatedSkills = selectActivatedSkills(enabledSkills);
    const availableSkills = enabledSkills.filter((s) => !s.activated);

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
        source: toPromptSkillSource(skill.source),
      }));

      const availableSkillsContent = skillsPrompts(skills, this.config.promptMode === 'lean');
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
    return contentParts.join('\n\n');
  }

  protected onInjected(context: PipelineContext): void {
    context.metadata.skillContext = {
      injected: true,
      skillsCount: this.config.enabledSkills?.length ?? 0,
    };
  }

  /**
   * Card-only discovery for the on-demand dynamic suffix. This deliberately
   * does not inject into the system prompt or preload skill bodies.
   */
  getOnDemandCards(context: PipelineContext): OnDemandSkillCard[] {
    if (this.config.contextMode !== 'on-demand' || this.config.enabled === false) return [];

    const lastUserMessage = [...context.messages]
      .reverse()
      .find((message) => message.role === 'user' && message.meta?.systemInjection !== true);
    const currentUserMessage =
      typeof lastUserMessage?.content === 'string'
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage?.content ?? '');

    return selectOnDemandSkillCards(this.config.enabledSkills, currentUserMessage);
  }
}

import { escapeXml } from '@lobechat/prompts';
import type { RuntimeSelectedSkill } from '@lobechat/types';
import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import { CONTEXT_INSTRUCTION, SYSTEM_CONTEXT_END, SYSTEM_CONTEXT_START } from '../base/constants';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    selectedSkillContext?: {
      injected: boolean;
      skillsCount: number;
    };
  }
}

const log = debug('context-engine:provider:SelectedSkillInjector');

export interface SelectedSkillInjectorConfig {
  enabled?: boolean;
  selectedSkills?: RuntimeSelectedSkill[];
}

export const formatSelectedSkills = (selectedSkills: RuntimeSelectedSkill[]): string | null => {
  if (selectedSkills.length === 0) return null;

  const lines = [
    'The user explicitly selected these skills for this request. Their full instructions are already loaded below — do NOT call activateSkill for these skills, use the provided content directly.',
    '<selected_skills>',
  ];

  for (const skill of selectedSkills) {
    if (skill.content) {
      lines.push(
        `  <skill identifier="${escapeXml(skill.identifier)}" name="${escapeXml(skill.name)}">`,
        skill.content,
        '  </skill>',
      );
    } else {
      lines.push(
        `  <skill identifier="${escapeXml(skill.identifier)}" name="${escapeXml(skill.name)}" />`,
      );
    }
  }

  lines.push('</selected_skills>');

  return lines.join('\n');
};

/**
 * Format selected skills as a complete system-context block for message content persistence.
 * Returns null if no skills with content are provided.
 */
export const formatSelectedSkillsContext = (
  selectedSkills: RuntimeSelectedSkill[],
): string | null => {
  const inner = formatSelectedSkills(selectedSkills);
  if (!inner) return null;

  return [
    SYSTEM_CONTEXT_START,
    CONTEXT_INSTRUCTION,
    `<selected_skill_context>`,
    inner,
    `</selected_skill_context>`,
    SYSTEM_CONTEXT_END,
  ].join('\n');
};

/**
 * Selected Skill Injector
 * Appends user-selected slash-menu skills to the last user message as ephemeral context.
 */
export class SelectedSkillInjector extends BaseLastUserContentProvider {
  readonly name = 'SelectedSkillInjector';

  constructor(
    private config: SelectedSkillInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.config.enabled === false) return this.markAsExecuted(context);

    const clonedContext = this.cloneContext(context);
    const selectedSkills = this.config.selectedSkills ?? [];

    if (selectedSkills.length === 0) {
      log('No selected skills, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const content = formatSelectedSkills(selectedSkills);

    if (!content) {
      log('No selected skill content generated, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const lastUserIndex = this.findLastUserMessageIndex(clonedContext.messages);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(content, 'selected_skill_context')
      : this.wrapWithSystemContext(content, 'selected_skill_context');

    this.appendToLastUserMessage(clonedContext, contentToAppend);

    clonedContext.metadata.selectedSkillContext = {
      injected: true,
      skillsCount: selectedSkills.length,
    };

    log('Selected skill context appended, skills count: %d', selectedSkills.length);

    return this.markAsExecuted(clonedContext);
  }
}

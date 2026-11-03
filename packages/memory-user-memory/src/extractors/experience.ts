import { renderPlaceholderTemplate } from '@lobechat/context-engine';

import { experiencePrompt } from '../prompts';
import type { ExperienceMemory } from '../schemas';
import { ExperienceMemorySchema } from '../schemas';
import type { ExtractorTemplateProps } from '../types';
import { buildGenerateObjectSchema } from '../utils/zod';
import { BaseMemoryExtractor } from './base';

export class ExperienceExtractor extends BaseMemoryExtractor<ExperienceMemory> {
  getPrompt(): string {
    return experiencePrompt;
  }

  protected getPromptName(): string {
    return 'layer-experience';
  }

  getSchema() {
    return buildGenerateObjectSchema(ExperienceMemorySchema, { name: 'experience_extraction' });
  }

  getResultSchema() {
    return ExperienceMemorySchema;
  }

  getTemplateProps(options: ExtractorTemplateProps) {
    return {
      availableCategories: options.availableCategories,
      language: options.language,
      retrievedContext: options.retrievedContexts?.join('\n\n') || 'No similar memories retrieved.',
      sessionDate: options.sessionDate,
      topK: options.topK,
      username: options.username,
    };
  }

  buildUserPrompt(options: ExtractorTemplateProps): string {
    if (!this.promptTemplate) {
      throw new Error('Prompt template not loaded');
    }

    return renderPlaceholderTemplate(this.promptTemplate!, this.getTemplateProps(options));
  }
}

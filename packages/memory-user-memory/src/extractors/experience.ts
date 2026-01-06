import { renderPlaceholderTemplate } from '@lobechat/context-engine';

import {
  ExperienceMemory,
  ExperienceMemorySchema
} from '../schemas';
import { ExtractorTemplateProps } from '../types';
import { buildGenerateObjectSchema } from '../utils/zod';
import { BaseMemoryExtractor } from './base';

export class ExperienceExtractor extends BaseMemoryExtractor<ExperienceMemory> {
  getPromptFileName(): string {
    return 'layers/experience.md';
  }

  getSchema() {
    return buildGenerateObjectSchema(
      ExperienceMemorySchema,
      { name: 'experience_extraction' },
    );
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

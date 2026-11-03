import { renderPlaceholderTemplate } from '@lobechat/context-engine';

import { preferencePrompt } from '../prompts';
import type { PreferenceMemory } from '../schemas';
import { PreferenceMemorySchema } from '../schemas';
import type { ExtractorTemplateProps } from '../types';
import { buildGenerateObjectSchema } from '../utils/zod';
import { BaseMemoryExtractor } from './base';

export class PreferenceExtractor extends BaseMemoryExtractor<PreferenceMemory> {
  getPrompt(): string {
    return preferencePrompt;
  }

  protected getPromptName(): string {
    return 'layer-preference';
  }

  getSchema() {
    return buildGenerateObjectSchema(PreferenceMemorySchema, { name: 'preference_extraction' });
  }

  getResultSchema() {
    return PreferenceMemorySchema;
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

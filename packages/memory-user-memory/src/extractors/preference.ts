import { renderPlaceholderTemplate } from '@lobechat/context-engine';

import {
  PreferenceMemory,
  PreferenceMemorySchema,
} from '../schemas';
import { ExtractorTemplateProps } from '../types';
import { buildGenerateObjectSchema } from '../utils/zod';
import { BaseMemoryExtractor } from './base';

export class PreferenceExtractor extends BaseMemoryExtractor<PreferenceMemory> {
  getPromptFileName(): string {
    return 'layers/preference.md';
  }

  getSchema() {
    return buildGenerateObjectSchema(
      PreferenceMemorySchema,
      { name: 'preference_extraction' },
    );
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

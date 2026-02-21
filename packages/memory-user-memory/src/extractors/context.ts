import { renderPlaceholderTemplate } from '@lobechat/context-engine';

import { contextPrompt } from '../prompts';
import type { ContextMemory } from '../schemas';
import { ContextMemorySchema } from '../schemas';
import type { ExtractorTemplateProps } from '../types';
import { buildGenerateObjectSchema } from '../utils/zod';
import { BaseMemoryExtractor } from './base';

export class ContextExtractor extends BaseMemoryExtractor<ContextMemory> {
  getPrompt(): string {
    return contextPrompt;
  }

  protected getPromptName(): string {
    return 'layer-context';
  }

  getSchema() {
    return buildGenerateObjectSchema(ContextMemorySchema, { name: 'context_extraction' });
  }

  getResultSchema() {
    return ContextMemorySchema;
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

import { renderPlaceholderTemplate } from '@lobechat/context-engine';

import { activityPrompt } from '../prompts';
import type { ActivityMemory } from '../schemas';
import { ActivityMemorySchema } from '../schemas';
import type { ExtractorTemplateProps } from '../types';
import { BaseMemoryExtractor } from './base';

export class ActivityExtractor extends BaseMemoryExtractor<ActivityMemory> {
  getPrompt(): string {
    return activityPrompt;
  }

  protected getPromptName(): string {
    return 'layer-activity';
  }

  getSchema() {
    return ActivityMemorySchema;
  }

  // Activity schema uses JSON Schema directly; no zod validation is applied here.
  protected getResultSchema() {
    return undefined;
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

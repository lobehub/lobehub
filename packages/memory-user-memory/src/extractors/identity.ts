import { renderPlaceholderTemplate } from '@lobechat/context-engine';

import { IdentityActions, IdentityActionsSchema } from '../schemas';
import { ExtractorOptions, ExtractorTemplateProps } from '../types';
import { buildGenerateObjectSchema } from '../utils/zod';
import { BaseMemoryExtractor } from './base';

export interface IdentityExtractorTemplateProps extends ExtractorTemplateProps {
  existingIdentitiesContext?: string;
}

export interface IdentityExtractorOptions extends ExtractorOptions {
  existingIdentitiesContext?: string;
}

export class IdentityExtractor extends BaseMemoryExtractor<
  IdentityActions,
  IdentityExtractorTemplateProps,
  IdentityExtractorOptions
> {
  protected getPromptFileName(): string {
    return 'layers/identity.md';
  }

  getSchema() {
    return buildGenerateObjectSchema(IdentityActionsSchema, {
      name: 'identity_extraction',
    });
  }

  protected getResultSchema() {
    return IdentityActionsSchema;
  }

  protected getTemplateProps(options: IdentityExtractorOptions) {
    return {
      availableCategories: options.availableCategories,
      existingIdentitiesContext: options.existingIdentitiesContext,
      language: options.language,
      retrievedContext: options.retrievedContexts?.join('\n\n') || 'No similar memories retrieved.',
      sessionDate: options.sessionDate,
      topK: options.topK,
      username: options.username,
    };
  }

  protected buildUserPrompt(options: IdentityExtractorOptions): string {
    if (!this.promptTemplate) {
      throw new Error('Prompt template not loaded');
    }

    return renderPlaceholderTemplate(this.promptTemplate!, this.getTemplateProps(options));
  }
}

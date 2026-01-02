import { renderPlaceholderTemplate } from '@lobechat/context-engine';
import type { GenerateObjectSchema } from '@lobechat/model-runtime';

import { GatekeeperResult, GatekeeperResultSchema } from '../schemas';
import { GatekeeperOptions } from '../types';
import { BaseMemoryExtractor } from './base';

export class UserMemoryGateKeeper extends BaseMemoryExtractor<GatekeeperResult, GatekeeperOptions> {
  getPromptFileName(): string {
    return 'gatekeeper.md';
  }

  getSchema(): GenerateObjectSchema {
    const layerDecision = {
      additionalProperties: false,
      properties: {
        reasoning: { type: 'string' },
        shouldExtract: { type: 'boolean' },
      },
      required: ['reasoning', 'shouldExtract'],
      type: 'object',
    } as const;

    return {
      name: 'gatekeeper_decision',
      schema: {
        additionalProperties: false,
        properties: {
          context: layerDecision,
          experience: layerDecision,
          identity: layerDecision,
          preference: layerDecision,
        },
        required: ['context', 'experience', 'identity', 'preference'],
        type: 'object' as const,
      },
      strict: true,
    };
  }

  getResultSchema() {
    return GatekeeperResultSchema;
  }

  getTemplateProps(options: GatekeeperOptions) {
    return {
      retrievedContext: options.retrievedContexts?.join('\n\n') || 'No similar memories retrieved.',
      topK: options.topK ?? 10,
    };
  }

  buildUserPrompt(options: GatekeeperOptions): string {
    if (!this.promptTemplate) {
      throw new Error('Prompt template not loaded');
    }

    return renderPlaceholderTemplate(this.promptTemplate!, this.getTemplateProps(options));
  }

  async check(options: GatekeeperOptions = {}) {
    return this.structuredCall(options);
  }
}

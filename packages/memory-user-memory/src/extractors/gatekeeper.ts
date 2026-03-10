import { renderPlaceholderTemplate } from '@lobechat/context-engine';
import type { GenerateObjectSchema } from '@lobechat/model-runtime';

import { gatekeeperPrompt } from '../prompts';
import type { GatekeeperResult } from '../schemas';
import { GatekeeperResultSchema } from '../schemas';
import type { GatekeeperOptions } from '../types';
import { BaseMemoryExtractor } from './base';

export class UserMemoryGateKeeper extends BaseMemoryExtractor<GatekeeperResult, GatekeeperOptions> {
  getPrompt(): string {
    return gatekeeperPrompt;
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
          activity: layerDecision,
          context: layerDecision,
          experience: layerDecision,
          identity: layerDecision,
          preference: layerDecision,
        },
        required: ['activity', 'context', 'experience', 'identity', 'preference'],
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

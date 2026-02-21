import { renderPlaceholderTemplate } from '@lobechat/context-engine';
import { z } from 'zod';

import { userPersonaPrompt } from '../prompts';
import type {
  PersonaExtractorOptions,
  PersonaTemplateProps,
  UserPersonaExtractionResult,
} from '../types';
import { BaseMemoryExtractor } from './base';

const resultSchema = z.object({
  diff: z.string().optional(),
  memoryIds: z.array(z.string()).optional(),
  persona: z.string(),
  reasoning: z.string().optional(),
  sourceIds: z.array(z.string()).optional(),
  tagline: z.string().optional(),
});

export class UserPersonaExtractor extends BaseMemoryExtractor<
  UserPersonaExtractionResult,
  PersonaTemplateProps,
  PersonaExtractorOptions
> {
  getPrompt() {
    return userPersonaPrompt;
  }

  getResultSchema() {
    return resultSchema;
  }

  protected getPromptName(): string {
    return 'user-persona';
  }

  // Use tool-calling instead of JSON schema for richer arguments parsing.
  protected getSchema(): undefined {
    return undefined;
  }

  protected getTools(_options: PersonaTemplateProps) {
    return [
      {
        function: {
          description:
            'Persist an updated user persona document that summarizes the user, preferences, relationships, and recent events.',
          name: 'commit_user_persona',
          parameters: {
            properties: {
              diff: {
                description: 'Bullet list of changes applied this run',
                type: 'string',
              },
              memoryIds: {
                description: 'Related memory IDs used to craft the persona',
                items: { type: 'string' },
                type: 'array',
              },
              persona: { description: 'Complete Markdown persona for the user', type: 'string' },
              reasoning: {
                description: 'Why these changes were applied',
                type: 'string',
              },
              sourceIds: {
                description:
                  'Source IDs (topic ID, document ID, or anything related) tied to this update',
                items: { type: 'string' },
                type: 'array',
              },
              tagline: {
                description: 'Short one-liner/tagline that captures the persona',
                type: 'string',
              },
            },
            required: ['persona'],
            type: 'object',
          },
        },
        type: 'function' as const,
      },
    ];
  }

  buildUserPrompt(options: PersonaTemplateProps): string {
    const sections = [
      '## Existing Persona (baseline)',
      options.existingPersona?.trim() || 'No existing persona provided.',
      '## Retrieved Memories / Signals',
      options.retrievedMemories?.trim() || 'N/A',
      '## Recent Events or Highlights',
      options.recentEvents?.trim() || 'N/A',
      '## User Provided Notes or Requests',
      options.personaNotes?.trim() || 'N/A',
      '## Extra Profile Context',
      options.userProfile?.trim() || 'N/A',
    ];

    return sections.join('\n\n');
  }

  async toolCall(options?: PersonaExtractorOptions): Promise<UserPersonaExtractionResult> {
    await this.ensurePromptTemplate();

    const systemPrompt = renderPlaceholderTemplate(
      this.promptTemplate || '',
      this.getTemplateProps(options || {}),
    );
    const userPrompt = this.buildUserPrompt(options || {});

    const messages = [
      { content: systemPrompt, role: 'system' as const },
      ...((options?.additionalMessages || []) as any),
      { content: userPrompt, role: 'user' as const },
    ];

    const result = (await this.runtime.generateObject({
      messages,
      model: this.model,
      tools: this.getTools(options || {}),
    })) as unknown;

    if (Array.isArray(result)) {
      const firstCall = result[0];
      const args =
        typeof firstCall?.arguments === 'string'
          ? JSON.parse(firstCall.arguments || '{}')
          : firstCall?.arguments;

      return resultSchema.parse(args || {});
    }

    return resultSchema.parse(result);
  }

  async structuredCall(options?: PersonaExtractorOptions): Promise<UserPersonaExtractionResult> {
    return this.toolCall(options);
  }
}

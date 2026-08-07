// @vitest-environment node
import { RequestTrigger } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type {
  AiGenerationObjectInput,
  AiGenerationObjectOptions,
  AiGenerationService,
} from '@/server/services/aiGeneration';

import { defaultTaskRecommendationConfig } from './config';
import { TaskRecommendationWriter } from './writer';

/** @example Connector evidence is converted into validated background-safe task drafts. */
describe('TaskRecommendationWriter', () => {
  /** @example The isolated writer owns prompt assembly, model selection, and schema validation. */
  it('generates structured recommendations with the configured agent', async () => {
    const generatedOutput = {
      recommendations: [
        {
          instruction: 'Inspect the pull request and return a private risk report.',
          reason: 'The lifecycle change needs focused analysis.',
          sourceUrls: ['https://github.com/lobehub/lobehub/pull/1'],
          title: 'Review LobeHub lifecycle changes',
        },
      ],
    };
    const generationCalls: Array<{
      input: AiGenerationObjectInput;
      options?: AiGenerationObjectOptions;
    }> = [];
    const generateObject: AiGenerationService['generateObject'] = async <T = unknown>(
      input: AiGenerationObjectInput,
      options?: AiGenerationObjectOptions,
    ) => {
      generationCalls.push({ input, options });
      return generatedOutput as T;
    };
    const writer = new TaskRecommendationWriter({
      generator: { generateObject },
      writerAgent: vi.fn(async () => ({ id: 'agent-1', model: 'model-1', provider: 'provider-1' })),
    });

    const recommendations = await writer.generate({
      context: '{"pullRequest":1}',
      guide: defaultTaskRecommendationConfig.providers.github,
      limit: 3,
      providerId: 'github',
      responseLanguage: 'en-US',
      writingGuide: defaultTaskRecommendationConfig.writing,
    });

    expect(recommendations).toHaveLength(1);
    expect(generationCalls).toHaveLength(1);
    const generatedCall = generationCalls.at(0);
    expect(generatedCall).toBeDefined();
    if (!generatedCall) throw new Error('Expected the recommendation writer to invoke generation');
    expect(generatedCall.input).toEqual(
      expect.objectContaining({ model: 'model-1', provider: 'provider-1' }),
    );
    expect(generatedCall.options).toEqual({ metadata: { trigger: RequestTrigger.Onboarding } });
    expect(generatedCall.input.messages.at(1)?.content).toContain(
      '<connector-evidence provider="github">',
    );
  });
});

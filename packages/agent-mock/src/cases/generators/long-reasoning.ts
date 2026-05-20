import { defineCase, llmStep } from '../../builders/defineCase';
import { defineGenerator } from './registry';

export interface LongReasoningParams {
  reasoningChars: number;
  textChars: number;
}

export const longReasoningGenerator = defineGenerator<LongReasoningParams>({
  id: 'long-reasoning',
  name: 'Long Reasoning',
  description: 'Reasoning of N chars before short answer',
  defaultParams: { reasoningChars: 5000, textChars: 200 },
  factory: ({ reasoningChars, textChars }) =>
    defineCase({
      id: `long-reasoning-${reasoningChars}`,
      name: `Long reasoning ${reasoningChars}c`,
      tags: ['reasoning', 'generated'],
      steps: [
        llmStep({
          reasoning: 'x'.repeat(reasoningChars),
          text: 'y'.repeat(textChars),
          durationMs: Math.max(1000, reasoningChars * 2),
        }),
      ],
    }),
});

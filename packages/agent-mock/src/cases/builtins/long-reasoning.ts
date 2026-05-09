import { defineCase, llmStep } from '../../builders/defineCase';

export const longReasoning = defineCase({
  id: 'long-reasoning',
  name: 'Long reasoning',
  description: '5000 character reasoning before short answer',
  tags: ['reasoning', 'builtin'],
  steps: [
    llmStep({
      reasoning: '思路'.repeat(1250),
      text: '综上所述，结论是：A。',
      durationMs: 6000,
    }),
  ],
});

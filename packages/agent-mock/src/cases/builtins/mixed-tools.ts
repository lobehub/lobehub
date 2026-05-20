import { defineCase, llmStep, toolStep } from '../../builders/defineCase';

export const mixedTools = defineCase({
  id: 'mixed-tools',
  name: 'Mixed tools',
  description: 'TodoWrite + Memory + Calculator interleaved',
  tags: ['mixed', 'builtin'],
  steps: [
    llmStep({ text: '先记忆，再计算，最后规划。', durationMs: 500 }),
    toolStep({
      identifier: 'lobe-memory',
      apiName: 'remember',
      arguments: JSON.stringify({ key: 'k', value: 'v' }),
      result: { success: true },
      durationMs: 150,
    }),
    toolStep({
      identifier: 'lobe-calculator',
      apiName: 'calculate',
      arguments: JSON.stringify({ expr: '2+2' }),
      result: { value: 4 },
      durationMs: 80,
    }),
    toolStep({
      identifier: 'lobe-todo-write',
      apiName: 'addTodo',
      arguments: JSON.stringify({ title: '验证结果' }),
      result: { success: true, id: 'todo-1' },
      durationMs: 100,
    }),
    llmStep({ text: '完成。', durationMs: 200 }),
  ],
});

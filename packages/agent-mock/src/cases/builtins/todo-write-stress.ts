import { defineCase, llmStep, toolStep } from '../../builders/defineCase';

export const todoWriteStress = defineCase({
  id: 'todo-write-stress',
  name: 'TodoWrite × 50',
  description: '50 sequential addTodo tool calls bracketed by short LLM steps',
  tags: ['stress', 'todo', 'builtin'],
  steps: [
    llmStep({
      text: '我将逐步规划 50 项任务，分为五个主题：环境、需求、设计、实现、验收。',
      reasoning: '按主题分组，每组 10 项；先思路后枚举。',
      durationMs: 800,
    }),
    ...Array.from({ length: 50 }, (_, i) =>
      toolStep({
        identifier: 'lobe-todo-write',
        apiName: 'addTodo',
        arguments: JSON.stringify({ title: `任务 ${i + 1}` }),
        result: { success: true, id: `todo-${i}`, title: `任务 ${i + 1}` },
        durationMs: 120,
      }),
    ),
    llmStep({ text: '已完成 50 项任务规划。', durationMs: 400 }),
  ],
});

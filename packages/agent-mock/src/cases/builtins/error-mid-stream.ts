import { defineCase, errorStep, llmStep, toolStep } from '../../builders/defineCase';

export const errorMidStream = defineCase({
  id: 'error-mid-stream',
  name: 'Error mid-stream',
  description: 'Tool call fails halfway, then runtime errors',
  tags: ['error', 'builtin'],
  steps: [
    llmStep({ text: '尝试调用工具。', durationMs: 400 }),
    toolStep({
      identifier: 'lobe-todo-write',
      apiName: 'addTodo',
      arguments: JSON.stringify({ title: 'fails' }),
      error: { message: 'Permission denied', type: 'ToolExecutionError' },
      durationMs: 200,
    }),
    errorStep({ message: 'Agent runtime aborted: tool failed' }),
  ],
});

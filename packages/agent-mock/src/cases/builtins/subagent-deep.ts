import { defineCase, llmStep, toolStep } from '../../builders/defineCase';

// v1: subagents not yet modeled in MockEvent stream — placeholder uses callAgent tool
export const subagentDeep = defineCase({
  id: 'subagent-deep',
  name: 'Subagent depth-3',
  description: 'Three nested callAgent tool calls (placeholder; full subagent threads in v2)',
  tags: ['subagent', 'builtin'],
  steps: [
    llmStep({ text: '委派子代理 1。', durationMs: 300 }),
    toolStep({
      identifier: 'lobe-call-agent',
      apiName: 'callAgent',
      arguments: JSON.stringify({ agentId: 'sub-1' }),
      result: { success: true, output: '子代理 1 完成' },
      durationMs: 1000,
    }),
    llmStep({ text: '委派子代理 2。', durationMs: 200 }),
    toolStep({
      identifier: 'lobe-call-agent',
      apiName: 'callAgent',
      arguments: JSON.stringify({ agentId: 'sub-2' }),
      result: { success: true, output: '子代理 2 完成' },
      durationMs: 800,
    }),
    llmStep({ text: '完成。', durationMs: 200 }),
  ],
});

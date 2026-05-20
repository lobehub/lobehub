import { defineCase, llmStep, toolStep } from '../../builders/defineCase';
import { defineGenerator } from './registry';

export interface SubagentTreeParams {
  depth: number;
  fanout: number;
}

export const subagentTreeGenerator = defineGenerator<SubagentTreeParams>({
  id: 'subagent-tree',
  name: 'Subagent Tree',
  description: 'Nested callAgent tool calls of depth × fanout',
  defaultParams: { depth: 3, fanout: 2 },
  factory: ({ depth, fanout }) => {
    const calls = depth * fanout;
    return defineCase({
      id: `subagent-tree-d${depth}-f${fanout}`,
      name: `Subagent ${depth}×${fanout}`,
      tags: ['subagent', 'generated'],
      steps: [
        llmStep({ text: `Spawning ${calls} subagents.`, durationMs: 300 }),
        ...Array.from({ length: calls }, (_, i) =>
          toolStep({
            identifier: 'lobe-call-agent',
            apiName: 'callAgent',
            arguments: JSON.stringify({ agentId: `sub-${i}` }),
            result: { success: true, output: `子代理 ${i} 完成` },
            durationMs: 600,
          }),
        ),
        llmStep({ text: '所有子代理完成。', durationMs: 200 }),
      ],
    });
  },
});

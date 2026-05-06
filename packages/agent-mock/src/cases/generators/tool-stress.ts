import { defineCase, llmStep, toolStep } from '../../builders/defineCase';
import { defineGenerator } from './registry';

export interface ToolStressParams {
  count: number;
  durationPerToolMs?: number;
  toolMix?: Array<{ identifier: string; apiName: string; weight: number }>;
}

export const toolStressGenerator = defineGenerator<ToolStressParams>({
  id: 'tool-stress',
  name: 'Tool Stress',
  description: 'Generate N tool calls bracketed by LLM steps',
  defaultParams: { count: 50, durationPerToolMs: 120 },
  factory: (params) => {
    const mix = params.toolMix ?? [
      { identifier: 'lobe-todo-write', apiName: 'addTodo', weight: 1 },
    ];
    const totalWeight = mix.reduce((s, m) => s + m.weight, 0);
    const pickTool = () => {
      let r = Math.random() * totalWeight;
      for (const m of mix) {
        r -= m.weight;
        if (r <= 0) return m;
      }
      return mix[0];
    };

    const tools = Array.from({ length: params.count }, (_, i) => {
      const m = pickTool();
      return toolStep({
        identifier: m.identifier,
        apiName: m.apiName,
        arguments: JSON.stringify({ index: i }),
        result: { success: true, index: i },
        durationMs: params.durationPerToolMs ?? 120,
      });
    });

    return defineCase({
      id: `tool-stress-${params.count}`,
      name: `Tool Stress × ${params.count}`,
      tags: ['stress', 'generated'],
      steps: [
        llmStep({ text: `Stress run with ${params.count} tools.`, durationMs: 300 }),
        ...tools,
        llmStep({ text: 'Stress run complete.', durationMs: 200 }),
      ],
    });
  },
});

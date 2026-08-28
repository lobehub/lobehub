import type {
  AgentGraphNode,
  RuntimeAdditionalContextFragment,
  RuntimeAdditionalContextValue,
} from '@lobechat/types';

type GraphPromptTrigger =
  | { type: 'after_compression' }
  | { type: 'every_n_node_steps'; interval: number }
  | { type: 'stage_start' };

interface GraphPromptMaterializerInput {
  allowedToolApiNames?: readonly string[];
  budgetStatus: GraphBudgetStatus;
  inputContext: RuntimeAdditionalContextValue;
  outputContract: RuntimeAdditionalContextValue;
  stage: string;
  taskInstruction: string;
  trigger?: GraphPromptTrigger;
}

type GraphBudgetStatus = 'near_exhaustion' | 'normal';

const NORMAL_GUIDANCE_INTERVAL = 8;
const NEAR_EXHAUSTION_GUIDANCE_INTERVAL = 4;

export const getGraphBudgetStatus = (
  node: Readonly<AgentGraphNode>,
  usedNodeRuntimeSteps: number,
): GraphBudgetStatus => {
  if (node.type !== 'agent' || node.maxAgentSteps === undefined) return 'normal';

  const warningWindow = Math.max(1, Math.ceil(node.maxAgentSteps * 0.2));
  const remainingSteps = Math.max(0, node.maxAgentSteps - usedNodeRuntimeSteps);

  return remainingSteps <= warningWindow ? 'near_exhaustion' : 'normal';
};

export const evaluateGraphPromptTrigger = (input: {
  budgetStatus: GraphBudgetStatus;
  isAfterCompression: boolean;
  usedNodeRuntimeSteps: number;
}): GraphPromptTrigger | undefined => {
  if (input.isAfterCompression) return { type: 'after_compression' };
  if (input.usedNodeRuntimeSteps === 0) return { type: 'stage_start' };

  const interval =
    input.budgetStatus === 'near_exhaustion'
      ? NEAR_EXHAUSTION_GUIDANCE_INTERVAL
      : NORMAL_GUIDANCE_INTERVAL;

  return input.usedNodeRuntimeSteps % interval === 0
    ? { interval, type: 'every_n_node_steps' }
    : undefined;
};

const createGuidanceFragment = (
  stage: string,
  budgetStatus: GraphBudgetStatus,
): RuntimeAdditionalContextFragment => ({
  content: {
    text:
      budgetStatus === 'near_exhaustion'
        ? [
            'The current Graph stage budget is nearly exhausted. Begin finalization now.',
            'Do not start new exploratory branches. Consolidate the evidence already gathered,',
            'and complete the remaining actions required by graph_node_context. Once those actions',
            'are complete, stop making tool calls and produce the stage result matching its output_contract.',
          ].join('\n')
        : 'The current Graph stage remains active. Continue following the constraints and output contract in graph_node_context.',
    type: 'text',
  },
  placement: 'virtual_tail',
  wrapper: {
    attributes: {
      stage,
      ...(budgetStatus === 'near_exhaustion' && { budget_status: 'near_exhaustion' }),
    },
    tag: 'graph_runtime_guidance',
  },
});

export const materializeGraphPromptContext = (
  input: GraphPromptMaterializerInput,
): readonly RuntimeAdditionalContextFragment[] => {
  const nodeContextFragment: RuntimeAdditionalContextFragment = {
    content: {
      sections: [
        { format: 'json', tag: 'input_context', value: input.inputContext },
        { format: 'text', tag: 'task_instruction', value: input.taskInstruction },
        ...(input.allowedToolApiNames === undefined
          ? []
          : [
              {
                format: 'compact_json' as const,
                tag: 'allowed_tool_api_names',
                value: input.allowedToolApiNames,
              },
            ]),
        { format: 'json', tag: 'output_contract', value: input.outputContract },
      ],
      type: 'sections',
    },
    placement: 'stable_prefix',
    wrapper: { tag: 'graph_node_context' },
  };

  return [
    nodeContextFragment,
    ...(input.trigger ? [createGuidanceFragment(input.stage, input.budgetStatus)] : []),
  ];
};

import { ToolNameResolver } from '@lobechat/context-engine';
import type { AgentGraphEdge, AgentGraphNode, ReasoningGraph } from '@lobechat/types';
import { AGENT_GRAPH_ROOT_NODE_ID } from '@lobechat/types';
import type { UnknownRecord } from '@lobechat/utils/object';
import { isRecord } from '@lobechat/utils/object';
import Ajv from 'ajv';

import type {
  Agent,
  AgentInstruction,
  AgentRuntimeContext,
  AgentState,
  FinishReason,
  GeneralAgentCallLLMInstructionPayload,
  GeneralAgentConfig,
} from '../types';
import { GeneralChatAgent } from './GeneralChatAgent';

const GRAPH_RUNTIME_STATE_KEY = '__graphRuntimeState';
const DEFAULT_MAX_GRAPH_INSTRUCTION_COUNT = 256;
const MAX_GRAPH_INSTRUCTION_COUNT_LIMIT = 1024;
const MAX_GRAPH_INTERNAL_TRANSITIONS = 4;
const MAX_NODE_OUTPUT_EXTRACTION_ATTEMPTS = 3;
const DEFAULT_NODE_OUTPUT_EXTRACTION_INSTRUCTION =
  'The current graph node has completed its work. Extract and submit the node deliverable from the conversation.';
const NODE_OUTPUT_EXTRACTION_FORMAT =
  'Return exactly one markdown fenced code block tagged json, containing a single JSON object that matches output_schema. Do not include any text outside the code block.';
const ajv = new Ajv({ allErrors: true, strict: false });
const conditionAjv = new Ajv({ allErrors: false, strict: true });

type GraphState =
  | {
      phase: 'init';
    }
  | {
      active: boolean;
      currentNode: string;
      incomingEdge: AgentGraphEdge;
      nodeStartStepCount?: number;
      phase: 'node_in';
    }
  | {
      active: boolean;
      attempts: number;
      currentNode: string;
      incomingEdge: AgentGraphEdge;
      nodeStepLimitExceeded?: boolean;
      phase: 'node_out';
    }
  | {
      currentNode: string;
      phase: 'transit';
    }
  | {
      reason: FinishReason;
      reasonDetail?: string;
      phase: 'fin';
    };

/**
 * Data store for graph reducers.
 *
 * Nodes only write their own completed output into store[nodeId]. Node-in resolves
 * its incoming edge input before starting execution. Node reducers consume that
 * resolved input for the current instruction instead of freely reading store,
 * otherwise graph dependencies become invisible prompt-side globals.
 *
 * Reading or writing store data must not advance GraphState by itself or create
 * side effects outside the returned orchestration.
 */
interface GraphContext {
  edgeTraversalCounts: Record<string, number>;
  store: UnknownRecord;
}

interface GraphRuntimeState {
  graphContext: GraphContext;
  graphState: GraphState;
  instructionCount: number;
}

interface ReducerInput {
  context: AgentRuntimeContext;
  graphContext: GraphContext;
  graphState: GraphState;
  state: AgentState;
}

interface GraphOrchestration {
  graphContext: GraphContext;
  graphState: GraphState;
  instruction?: AgentInstruction | AgentInstruction[];
}

type NodeOutputExtraction =
  | {
      ok: true;
      output: UnknownRecord;
      raw: string;
    }
  | {
      error: string;
      ok: false;
      raw: string;
    };

type EdgeSelection =
  | {
      edge: AgentGraphEdge;
      reason: 'blocked_by_limit';
    }
  | {
      edge: AgentGraphEdge;
      reason: 'matched';
    }
  | {
      reason: 'no_match';
    };

interface OutputValidation {
  error?: string;
  ok: boolean;
}

type PromptValue = PromptArray | PromptObject | boolean | null | number | string | undefined;

interface PromptArray extends Array<PromptValue> {}

interface PromptObject {
  [key: string]: PromptValue;
}

/**
 * GraphAgent is a graph-level orchestrator over the normal AgentRuntime loop.
 *
 * The runtime still executes concrete instructions.
 * This class only keeps the graph routing state:
 *
 * init -> node_in -> node_out -> transit -> fin
 *
 * - init: validate graph root edge and move to its target node.
 * - node_in: let the current node run; node internals may forward to another agent policy.
 * - node_out: collect the completed node's result.
 * - transit: choose the next graph node or finish.
 * - fin: terminal graph state.
 *
 * Handlers return GraphOrchestration, not just GraphState, because some states can already produce
 * a runtime instruction to forward. GraphState must remain routing state only; runtime instructions
 * are per-step output and must not be stored in metadata.
 *
 * Only the state handlers (onInit/onNodeIn/onNodeOut/onTransit/onFin) may advance GraphState.
 * All other methods are adapters: runner commits the handler result, and resolveRuntimeInstruction only
 * forwards the runtime instruction or terminal finish. Non-handler methods may only return finish for
 * out-of-band safety failures; they must not introduce normal graph transitions.
 */
export class GraphAgent implements Agent {
  private generalConfig: GeneralAgentConfig;
  private graph: ReasoningGraph;

  constructor(config: GeneralAgentConfig & { graph: ReasoningGraph }) {
    const { graph, ...generalConfig } = config;
    this.graph = graph;
    this.generalConfig = generalConfig;
  }

  // observation -> orchestration -> instruction
  async runner(
    context: AgentRuntimeContext,
    state: AgentState,
  ): Promise<AgentInstruction | AgentInstruction[]> {
    let { graphContext, graphState, instructionCount } = this.loadGraphRuntimeState(state);
    const maxInstructionCount = Math.min(
      this.graph.maxInstructionCount ?? DEFAULT_MAX_GRAPH_INSTRUCTION_COUNT,
      MAX_GRAPH_INSTRUCTION_COUNT_LIMIT,
    );

    if (graphState.phase !== 'fin' && instructionCount >= maxInstructionCount) {
      this.updateGraphRuntimeState(state, {
        graphContext,
        graphState: {
          reason: 'error_recovery',
          reasonDetail:
            `graph_instruction_limit_reached: Graph "${this.graph.name}" reached ` +
            `maxInstructionCount ${maxInstructionCount}`,
          phase: 'fin',
        },
        instructionCount,
      });

      return {
        reason: 'error_recovery',
        reasonDetail:
          `graph_instruction_limit_reached: Graph "${this.graph.name}" reached ` +
          `maxInstructionCount ${maxInstructionCount}`,
        type: 'finish',
      };
    }

    // A runtime work frame does not map 1:1 to a graph phase.
    // Some graph phases only update graph state/store and cannot produce a runtime instruction.
    // Advance a bounded number of internal graph phases until one lowers to a runtime instruction
    // or the graph reaches fin.
    for (let index = 0; index < MAX_GRAPH_INTERNAL_TRANSITIONS; index++) {
      const orchestration = await this.orchestrate({ context, graphContext, graphState, state });

      graphContext = orchestration.graphContext;
      graphState = orchestration.graphState;
      this.updateGraphRuntimeState(state, { graphContext, graphState, instructionCount });

      const instruction = this.resolveRuntimeInstruction(orchestration);

      // If the graph state machine lowers to a runtime instruction or reaches fin,
      // we can return the instruction to the runtime.
      if (instruction) {
        if (!this.hasFinishInstruction(instruction)) {
          instructionCount += 1;
          this.updateGraphRuntimeState(state, { graphContext, graphState, instructionCount });
        }

        return instruction;
      }
    }

    // That should not happen; the graph should always yield an instruction or reach fin within a few transitions.
    // If it does, force a finish to avoid infinite loops.
    this.updateGraphRuntimeState(state, {
      graphContext,
      graphState: {
        reason: 'error_recovery',
        reasonDetail: `graph_internal_transition_limit_reached: ${MAX_GRAPH_INTERNAL_TRANSITIONS}`,
        phase: 'fin',
      },
      instructionCount,
    });

    return {
      reason: 'error_recovery',
      reasonDetail: `graph_internal_transition_limit_reached: ${MAX_GRAPH_INTERNAL_TRANSITIONS}`,
      type: 'finish',
    };
  }

  /**
   * Dispatches the current graph phase to its reducer.
   *
   * This method does not choose the next phase. Each phase handler returns the
   * next GraphState/GraphContext, and runner commits that returned state after
   * every internal graph step.
   */
  private async orchestrate(input: ReducerInput): Promise<GraphOrchestration> {
    switch (input.graphState.phase) {
      case 'init': {
        return this.onInit(input);
      }

      case 'node_in': {
        return this.onNodeIn(input);
      }

      case 'node_out': {
        return this.onNodeOut(input);
      }

      case 'transit': {
        return this.onTransit(input);
      }

      case 'fin': {
        return this.onFin(input);
      }
    }
  }

  private onInit(input: ReducerInput): GraphOrchestration {
    const [rootEdge] = this.getEdgesFrom(AGENT_GRAPH_ROOT_NODE_ID);

    if (!rootEdge) {
      return {
        graphContext: input.graphContext,
        graphState: {
          reason: 'error_recovery',
          reasonDetail:
            `graph_root_transition_missing: Graph "${this.graph.name}" must define ` +
            `one "${AGENT_GRAPH_ROOT_NODE_ID}" outgoing edge with an instruction`,
          phase: 'fin',
        },
      };
    }

    if (!this.getNodeById(rootEdge.to)) {
      return {
        graphContext: input.graphContext,
        graphState: {
          reason: 'error_recovery',
          reasonDetail: `graph_node_missing: Graph node "${rootEdge.to}" not found`,
          phase: 'fin',
        },
      };
    }

    const lastUserMessage = [...input.state.messages]
      .reverse()
      .find((message) => message.role === 'user');
    const query =
      typeof lastUserMessage?.content === 'string'
        ? lastUserMessage.content
        : (JSON.stringify(lastUserMessage?.content ?? '') ?? '');

    return {
      graphContext: this.storeReducers.nodeStore(input.graphContext, AGENT_GRAPH_ROOT_NODE_ID, {
        query,
      }),
      graphState: {
        active: false,
        currentNode: rootEdge.to,
        incomingEdge: rootEdge,
        phase: 'node_in',
      },
    };
  }

  private async onNodeIn(input: ReducerInput): Promise<GraphOrchestration> {
    const graphState = input.graphState as Extract<GraphState, { phase: 'node_in' }>;
    const { context, state } = input;
    const node = this.getNodeById(graphState.currentNode);

    if (!node) {
      return {
        graphContext: input.graphContext,
        graphState: {
          reason: 'error_recovery',
          reasonDetail: `graph_node_missing: Graph node "${graphState.currentNode}" not found`,
          phase: 'fin',
        },
      };
    }

    const tools = node.type === 'agent' ? this.getNodeTools(node, state) : [];
    const allowedToolNames =
      node.type === 'agent' && !node.allowedToolApiNames
        ? undefined
        : tools
            .map((tool) => tool?.function?.name)
            .filter((name): name is string => typeof name === 'string');

    if (!graphState.active) {
      const prompt = this.renderPrompt({
        input_context: this.resolveNodeInputContext(graphState.incomingEdge, input),
        output_contract: this.getOutputSchema(graphState.incomingEdge) as PromptObject,
        task_instruction: graphState.incomingEdge.instruction,
      });
      const callLlm = (prompt: string): AgentInstruction => {
        const payload: GeneralAgentCallLLMInstructionPayload = {
          allowedToolNames,
          messages: [...state.messages, { content: prompt, role: 'user' as const }],
          model: state.modelRuntimeConfig?.model ?? '',
          provider: state.modelRuntimeConfig?.provider ?? '',
          tools,
        };

        return {
          payload,
          stepLabel: graphState.currentNode,
          type: 'call_llm',
        };
      };

      return {
        graphContext: input.graphContext,
        graphState: {
          ...graphState,
          active: true,
          nodeStartStepCount: state.stepCount,
        },
        instruction: callLlm(prompt),
      };
    }

    if (node.type === 'llm' && context.phase === 'llm_result') {
      return {
        graphContext: input.graphContext,
        graphState: {
          active: false,
          attempts: 0,
          currentNode: graphState.currentNode,
          incomingEdge: graphState.incomingEdge,
          phase: 'node_out',
        },
      };
    }

    if (
      node.type === 'agent' &&
      node.maxAgentSteps !== undefined &&
      node.maxAgentSteps > 0 &&
      graphState.nodeStartStepCount !== undefined &&
      state.stepCount - graphState.nodeStartStepCount >= node.maxAgentSteps
    ) {
      return {
        graphContext: input.graphContext,
        graphState: {
          active: false,
          attempts: 0,
          currentNode: graphState.currentNode,
          incomingEdge: graphState.incomingEdge,
          nodeStepLimitExceeded: true,
          phase: 'node_out',
        },
      };
    }

    const instruction = await new GeneralChatAgent({
      ...this.generalConfig,
      allowedToolNames,
      tools,
    }).runner(context, state);

    if (this.hasFinishInstruction(instruction)) {
      return {
        graphContext: input.graphContext,
        graphState: {
          active: false,
          attempts: 0,
          currentNode: graphState.currentNode,
          incomingEdge: graphState.incomingEdge,
          phase: 'node_out',
        },
      };
    }

    return {
      graphContext: input.graphContext,
      graphState,
      instruction,
    };
  }

  private onNodeOut(input: ReducerInput): GraphOrchestration {
    const graphState = input.graphState as Extract<GraphState, { phase: 'node_out' }>;
    if (graphState.active && input.context.phase !== 'llm_result') {
      return {
        graphContext: input.graphContext,
        graphState: {
          reason: 'error_recovery',
          reasonDetail: `graph_node_output_extraction_unexpected_phase: Expected llm_result for node "${graphState.currentNode}" output extraction, got "${input.context.phase}"`,
          phase: 'fin',
        },
      };
    }

    if (!graphState.incomingEdge.output?.fields?.length) {
      return {
        graphContext: input.graphContext,
        graphState: {
          currentNode: graphState.currentNode,
          phase: 'transit',
        },
      };
    }

    const extraction = this.extractNodeOutput(input);

    if (extraction.ok) {
      const validation = this.validateNodeOutput(graphState.incomingEdge, extraction.output);

      if (!validation.ok) {
        return this.retryNodeOutputExtraction(input, graphState, {
          error:
            validation.error ?? 'The node output did not match the selected edge output schema.',
          ok: false,
          raw: extraction.raw,
        });
      }

      return {
        graphContext: this.storeReducers.nodeStore(
          input.graphContext,
          graphState.currentNode,
          extraction.output,
        ),
        graphState: {
          currentNode: graphState.currentNode,
          phase: 'transit',
        },
      };
    }

    return this.retryNodeOutputExtraction(input, graphState, extraction);
  }

  private retryNodeOutputExtraction(
    input: ReducerInput,
    graphState: Extract<GraphState, { phase: 'node_out' }>,
    extraction: Extract<NodeOutputExtraction, { ok: false }>,
  ): GraphOrchestration {
    if (graphState.attempts >= MAX_NODE_OUTPUT_EXTRACTION_ATTEMPTS) {
      return {
        graphContext: this.storeReducers.nodeStore(input.graphContext, graphState.currentNode, {
          _extractionError: extraction.error,
          _raw: extraction.raw,
        }),
        graphState: {
          currentNode: graphState.currentNode,
          phase: 'transit',
        },
      };
    }

    const nextAttempt = graphState.attempts + 1;
    const previousError = graphState.nodeStepLimitExceeded
      ? `The node reached its action budget. ${extraction.error}`
      : extraction.error;
    const extractionPrompt = this.renderPrompt({
      extraction_task: {
        instruction:
          graphState.incomingEdge.output?.instruction ?? DEFAULT_NODE_OUTPUT_EXTRACTION_INSTRUCTION,
        format_instruction: NODE_OUTPUT_EXTRACTION_FORMAT,
        output_schema: this.getOutputSchema(graphState.incomingEdge) as PromptObject,
        previous_error: previousError,
      },
    });
    const payload: GeneralAgentCallLLMInstructionPayload = {
      allowedToolNames: [],
      messages: [...input.state.messages, { content: extractionPrompt, role: 'user' as const }],
      model: input.state.modelRuntimeConfig?.model ?? '',
      provider: input.state.modelRuntimeConfig?.provider ?? '',
      tools: [],
    };

    return {
      graphContext: input.graphContext,
      graphState: {
        ...graphState,
        active: true,
        attempts: nextAttempt,
      },
      instruction: {
        payload,
        stepLabel: `${graphState.currentNode}:extract`,
        type: 'call_llm',
      },
    };
  }

  private onTransit(input: ReducerInput): GraphOrchestration {
    const graphState = input.graphState as Extract<GraphState, { phase: 'transit' }>;

    const output = this.storeSelectors.nodeStore(graphState.currentNode)(input.graphContext);
    const edgeSelection = this.selectNextEdge(graphState.currentNode, output, input.graphContext);

    if (edgeSelection.reason === 'blocked_by_limit') {
      return {
        graphContext: input.graphContext,
        graphState: {
          reason: 'error_recovery',
          reasonDetail:
            `graph_edge_limit_reached: Graph "${this.graph.name}" reached maxTraversals for edge ` +
            `"${edgeSelection.edge.from}" -> "${edgeSelection.edge.to}"`,
          phase: 'fin',
        },
      };
    }

    if (edgeSelection.reason === 'no_match') {
      if (graphState.currentNode === this.graph.terminal) {
        return {
          graphContext: input.graphContext,
          graphState: {
            reason: 'completed',
            reasonDetail: `graph_completed: Graph "${this.graph.name}" completed at terminal node "${graphState.currentNode}"`,
            phase: 'fin',
          },
        };
      }

      return {
        graphContext: input.graphContext,
        graphState: {
          reason: 'error_recovery',
          reasonDetail: `graph_no_valid_edge: No valid edge from node "${graphState.currentNode}"`,
          phase: 'fin',
        },
      };
    }

    const { edge } = edgeSelection;

    if (!this.getNodeById(edge.to)) {
      return {
        graphContext: input.graphContext,
        graphState: {
          reason: 'error_recovery',
          reasonDetail: `graph_node_missing: Graph edge target "${edge.to}" not found`,
          phase: 'fin',
        },
      };
    }

    return {
      graphContext: this.updateEdgeTraversalCount(input.graphContext, edge),
      graphState: {
        active: false,
        currentNode: edge.to,
        incomingEdge: edge,
        phase: 'node_in',
      },
    };
  }

  private onFin(input: ReducerInput): GraphOrchestration {
    return { graphContext: input.graphContext, graphState: input.graphState };
  }

  private resolveRuntimeInstruction(
    orchestration: GraphOrchestration,
  ): AgentInstruction | AgentInstruction[] | undefined {
    if (orchestration.instruction) return orchestration.instruction;
    const { graphState: nextGraphState } = orchestration;

    if (nextGraphState.phase === 'fin') {
      return {
        reason: nextGraphState.reason,
        reasonDetail: nextGraphState.reasonDetail,
        type: 'finish',
      };
    }
  }

  private hasFinishInstruction(instruction: AgentInstruction | AgentInstruction[]): boolean {
    return Array.isArray(instruction)
      ? instruction.some((item) => item.type === 'finish')
      : instruction.type === 'finish';
  }

  private loadGraphRuntimeState(state: Readonly<AgentState>): GraphRuntimeState {
    const graphRuntimeState = state.metadata?.[GRAPH_RUNTIME_STATE_KEY] as
      GraphRuntimeState | undefined;

    if (!graphRuntimeState) {
      return {
        graphContext: {
          edgeTraversalCounts: {},
          store: {},
        },
        graphState: { phase: 'init' },
        instructionCount: 0,
      };
    }

    return {
      graphContext: {
        edgeTraversalCounts: graphRuntimeState.graphContext.edgeTraversalCounts ?? {},
        store: graphRuntimeState.graphContext.store ?? {},
      },
      graphState: graphRuntimeState.graphState,
      instructionCount:
        graphRuntimeState.instructionCount ??
        ((graphRuntimeState.graphContext as GraphContext & { instructionCount?: number })
          .instructionCount ||
          0),
    };
  }

  private updateGraphRuntimeState(state: AgentState, graphRuntimeState: GraphRuntimeState): void {
    state.metadata ??= {};
    state.metadata[GRAPH_RUNTIME_STATE_KEY] = graphRuntimeState;
  }

  private updateEdgeTraversalCount(
    graphContext: Readonly<GraphContext>,
    edge: Readonly<AgentGraphEdge>,
  ): GraphContext {
    const edgeKey = this.getEdgeKey(edge);

    return {
      ...graphContext,
      edgeTraversalCounts: {
        ...graphContext.edgeTraversalCounts,
        [edgeKey]: (graphContext.edgeTraversalCounts[edgeKey] ?? 0) + 1,
      },
    };
  }

  private storeReducers = {
    nodeStore: (
      graphContext: Readonly<GraphContext>,
      nodeId: string,
      value: UnknownRecord,
    ): GraphContext => {
      return {
        ...graphContext,
        store: {
          ...graphContext.store,
          [nodeId]: value,
        },
      };
    },
  };

  private storeSelectors = {
    nodeStore: (nodeId: string) => {
      return (graphContext: Readonly<GraphContext>): UnknownRecord | undefined => {
        const value = graphContext.store[nodeId];
        return isRecord(value) ? value : undefined;
      };
    },
  };

  private getNodeTools(node: Readonly<AgentGraphNode>, state: AgentState): any[] {
    if (node.type !== 'agent') return [];

    const rootTools =
      this.generalConfig.tools ?? state.tools ?? state.operationToolSet?.tools ?? [];
    if (!node.allowedToolApiNames) return rootTools;

    const allowedApiNames = new Set(node.allowedToolApiNames);
    const manifestMap = state.operationToolSet?.manifestMap ?? state.toolManifestMap;
    const toolNameResolver = new ToolNameResolver();
    const allowedToolNames = new Set<string>();

    for (const [identifier, manifest] of Object.entries(manifestMap)) {
      for (const api of manifest.api ?? []) {
        if (allowedApiNames.has(api.name)) {
          allowedToolNames.add(toolNameResolver.generate(identifier, api.name, manifest.type));
        }
      }
    }

    return rootTools.filter((tool) => allowedToolNames.has(tool?.function?.name));
  }

  private getNodeById(nodeId: string): AgentGraphNode | undefined {
    return this.graph.nodes[nodeId];
  }

  private getEdgesFrom(nodeId: string): AgentGraphEdge[] {
    return this.graph.edges.filter((edge) => edge.from === nodeId);
  }

  private getEdgeKey(edge: Readonly<AgentGraphEdge>): string {
    return `${edge.from}->${edge.to}`;
  }

  private toPromptValue(value: unknown, seen = new WeakSet<object>()): PromptValue {
    if (
      value === undefined ||
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    if (typeof value === 'bigint') return value.toString();

    if (Array.isArray(value)) {
      return value.map((item) => this.toPromptValue(item, seen));
    }

    if (!isRecord(value)) return undefined;

    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    const promptObject: PromptObject = {};
    for (const [key, item] of Object.entries(value)) {
      promptObject[key] = this.toPromptValue(item, seen);
    }

    seen.delete(value);
    return promptObject;
  }

  private resolveNodeInputContext(
    edge: Readonly<AgentGraphEdge>,
    input: ReducerInput,
  ): PromptObject {
    const fields = edge.input?.fields;
    const sourceOutput = this.storeSelectors.nodeStore(edge.from)(input.graphContext);

    if (!fields || fields.length === 0) {
      return { value: this.toPromptValue(sourceOutput ?? {}) };
    }

    const inputFields: PromptObject = {};
    const rawFallback: PromptObject = {};

    for (const field of fields) {
      const source = this.storeSelectors.nodeStore(field.from)(input.graphContext);
      const value = this.readValue(source, field.field);
      const registeredField = this.graph.fields[field.field];

      if (value !== undefined) {
        inputFields[field.field] = {
          desc: field.desc ?? registeredField?.desc ?? field.field,
          value: this.toPromptValue(value),
        };
        continue;
      }

      if (source?._raw !== undefined && rawFallback[field.from] === undefined) {
        rawFallback[field.from] = {
          reason:
            'Declared input fields were missing from this source output. Use this raw source output as fallback context.',
          value: this.toPromptValue(source._raw),
        };
      }
    }

    return {
      fields: inputFields,
      rawFallback: Object.keys(rawFallback).length > 0 ? rawFallback : undefined,
    };
  }

  private validateNodeOutput(
    edge: Readonly<AgentGraphEdge>,
    output: Readonly<UnknownRecord>,
  ): OutputValidation {
    const fields = edge.output?.fields;

    if (!fields || fields.length === 0) return { ok: true };

    const outputSchema = this.getOutputSchema(edge);

    if (ajv.validate(outputSchema, output) === true) return { ok: true };

    const errors = ajv.errors ?? [];

    return {
      error:
        `The selected edge "${edge.from}" -> "${edge.to}" requires an output object that matches this schema:\n` +
        `\`\`\`json\n${JSON.stringify(outputSchema, null, 2)}\n\`\`\`\n` +
        (errors.length === 0
          ? 'The previous JSON object did not match the selected edge output schema.'
          : errors
              .slice(0, 8)
              .map((error) => {
                const path = error.instancePath || '/';
                return `${path} ${error.message ?? 'does not match the output schema'}`;
              })
              .join('\n')),
      ok: false,
    };
  }

  private getOutputSchema(edge: Readonly<AgentGraphEdge>): UnknownRecord {
    const fields = edge.output?.fields ?? [];

    return {
      additionalProperties: true,
      properties: Object.fromEntries(
        fields.map((field) => {
          const registeredField = this.graph.fields[field.field];

          return [
            field.field,
            {
              ...registeredField?.schema,
              description: field.desc ?? registeredField?.desc ?? field.field,
            },
          ];
        }),
      ),
      required: fields.filter((field) => field.required !== false).map((field) => field.field),
      type: 'object',
    };
  }

  private readValue(source: UnknownRecord | undefined, path: string): unknown {
    if (!source) return undefined;

    return path.split('.').reduce<unknown>((value, key) => {
      return isRecord(value) ? value[key] : undefined;
    }, source);
  }

  private selectNextEdge(
    currentNode: string,
    output: UnknownRecord | undefined,
    graphContext: Readonly<GraphContext>,
  ): EdgeSelection {
    let blockedEdge: AgentGraphEdge | undefined;
    let defaultEdge: AgentGraphEdge | undefined;

    for (const edge of this.getEdgesFrom(currentNode)) {
      if (!edge.condition) {
        defaultEdge ??= edge;
        continue;
      }
      if (!this.evaluateEdgeCondition(edge, output)) continue;

      const edgeKey = this.getEdgeKey(edge);
      const traversalCount = graphContext.edgeTraversalCounts[edgeKey] ?? 0;

      if (edge.maxTraversals !== undefined && traversalCount >= edge.maxTraversals) {
        blockedEdge ??= edge;
        continue;
      }

      return { edge, reason: 'matched' };
    }

    if (defaultEdge) {
      const edgeKey = this.getEdgeKey(defaultEdge);
      const traversalCount = graphContext.edgeTraversalCounts[edgeKey] ?? 0;

      if (defaultEdge.maxTraversals !== undefined && traversalCount >= defaultEdge.maxTraversals) {
        return { edge: defaultEdge, reason: 'blocked_by_limit' };
      }

      return { edge: defaultEdge, reason: 'matched' };
    }

    if (blockedEdge) return { edge: blockedEdge, reason: 'blocked_by_limit' };

    return { reason: 'no_match' };
  }

  private evaluateEdgeCondition(edge: Readonly<AgentGraphEdge>, output: UnknownRecord | undefined) {
    if (!edge.condition || !output) return false;

    try {
      return conditionAjv.validate(edge.condition, output) === true;
    } catch {
      return false;
    }
  }

  private extractNodeOutput(input: ReducerInput): NodeOutputExtraction {
    const payload = input.context.payload;
    const payloadResult = isRecord(payload) ? payload.result : undefined;
    const contentFromPayload =
      isRecord(payloadResult) && typeof payloadResult.content === 'string'
        ? payloadResult.content
        : undefined;
    const lastAssistantMessage = [...input.state.messages]
      .reverse()
      .find((message) => message.role === 'assistant');
    const content =
      contentFromPayload ??
      (typeof lastAssistantMessage?.content === 'string'
        ? lastAssistantMessage.content
        : (JSON.stringify(lastAssistantMessage?.content ?? '') ?? ''));

    const fenceStart = content.indexOf('```');
    let jsonText = content.trim();

    if (fenceStart !== -1) {
      const contentAfterFence = content.slice(fenceStart + 3);
      const newlineIndex = contentAfterFence.indexOf('\n');
      const bodyStart = newlineIndex === -1 ? 0 : newlineIndex + 1;
      const fenceEnd = contentAfterFence.indexOf('```', bodyStart);
      jsonText = (
        fenceEnd === -1
          ? contentAfterFence.slice(bodyStart)
          : contentAfterFence.slice(bodyStart, fenceEnd)
      ).trim();
    }

    try {
      const parsed: unknown = JSON.parse(jsonText);

      if (isRecord(parsed)) return { ok: true, output: parsed, raw: content };
    } catch {
      return {
        error: 'The node output is not valid JSON.',
        ok: false,
        raw: content,
      };
    }

    return {
      error: 'The node output JSON must be an object.',
      ok: false,
      raw: content,
    };
  }

  private renderPrompt(input: PromptObject, separator = '\n\n'): string {
    const escapeXmlContent = (value: string): string =>
      value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

    const renderEntry = (key: string, value: PromptValue): string => {
      if (value === undefined || value === null || value === '') return '';

      const name = key.replaceAll(/[^\w.-]/g, '_');

      if (Array.isArray(value)) {
        return value
          .map((item) => renderEntry(name, item))
          .filter(Boolean)
          .join('\n');
      }

      if (value && typeof value === 'object') {
        const content = this.renderPrompt(value as PromptObject, '\n');
        return content ? `<${name}>\n${content}\n</${name}>` : '';
      }

      const content = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '');

      return `<${name}>${escapeXmlContent(content)}</${name}>`;
    };

    return Object.entries(input)
      .map(([key, value]) => renderEntry(key, value))
      .filter(Boolean)
      .join(separator);
  }
}

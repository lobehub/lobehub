import type {
  Agent,
  AgentInstruction,
  AgentRuntimeContext,
  AgentState,
  GeneralAgentCallLLMInstructionPayload,
  GeneralAgentConfig,
  GraphContext,
  ReasoningGraph,
} from '../types';
import { GeneralChatAgent } from './GeneralChatAgent';

const GRAPH_CONTEXT_KEY = '__graphContext';

/**
 * GraphAgent — A graph-driven Agent that decorates GeneralChatAgent.
 *
 * Instead of the default phase-driven loop (LLM decides flow),
 * GraphAgent uses a declarative ReasoningGraph to drive execution:
 *
 * 1. Each graph node maps to one or more AgentRuntime steps
 * 2. 'agent' nodes delegate to GeneralChatAgent for full tool-calling loops
 * 3. 'llm' nodes do a single LLM call with structured output
 * 4. Transitions are evaluated programmatically (not by LLM)
 * 5. Backtracking is supported with configurable limits
 *
 * Key mechanism: intercept GeneralChatAgent's 'finish' instruction.
 * When the inner agent finishes, GraphAgent checks if the graph has more
 * nodes to execute. Only when the terminal node completes does GraphAgent
 * return a real 'finish'.
 *
 * Agent vs LLM nodes:
 * - 'agent' nodes: prompt sent WITHOUT JSON schema → agent loop with tools →
 *   on finish, extra LLM call to extract structured output
 * - 'llm' nodes: prompt sent WITH JSON schema → single structured LLM call
 */
export class GraphAgent implements Agent {
  private innerAgent: GeneralChatAgent;
  private graph: ReasoningGraph;

  constructor(config: GeneralAgentConfig & { graph: ReasoningGraph }) {
    const { graph, ...generalConfig } = config;
    this.graph = graph;
    this.innerAgent = new GeneralChatAgent(generalConfig);
  }

  async runner(
    context: AgentRuntimeContext,
    state: AgentState,
  ): Promise<AgentInstruction | AgentInstruction[]> {
    const gc = this.getGraphContext(state);

    // First call — initialize graph and start entry node
    if (!gc) {
      return this.initGraph(context, state);
    }

    const node = this.graph.states[gc.currentNode];
    if (!node) {
      return {
        reason: 'error_recovery',
        reasonDetail: `Graph node "${gc.currentNode}" not found`,
        type: 'finish',
      };
    }

    // Agent node: delegate to GeneralChatAgent for the tool-calling loop
    if (gc.nodeActive && node.type === 'agent') {
      // If we're in the extraction phase, handle the extraction result
      if (gc.extracting) {
        if (context.phase === 'llm_result') {
          gc.extracting = false;
          return this.onNodeComplete(state, gc);
        }
        return this.innerAgent.runner(context, state);
      }

      const instruction = await this.innerAgent.runner(context, state);

      // Intercept finish — agent loop done, now extract structured output
      if (!Array.isArray(instruction) && instruction.type === 'finish') {
        return this.startExtraction(state, gc);
      }

      if (Array.isArray(instruction)) {
        const hasFinish = instruction.some((i) => i.type === 'finish');
        if (hasFinish) {
          return this.startExtraction(state, gc);
        }
      }

      // Otherwise pass through (call_llm, call_tool, etc.)
      return instruction;
    }

    // LLM node: after the LLM result comes back, extract output and advance
    if (gc.nodeActive && node.type === 'llm') {
      if (context.phase === 'llm_result') {
        return this.onNodeComplete(state, gc);
      }
      // Delegate other phases (like compression_result) to inner agent
      return this.innerAgent.runner(context, state);
    }

    // nodeActive is false — we're at a graph transition point, start the next node
    return this.startNode(gc, state);
  }

  /**
   * Initialize the graph: set up context, start entry node
   */
  private initGraph(_context: AgentRuntimeContext, state: AgentState): AgentInstruction {
    const lastUserMessage = [...state.messages].reverse().find((m: any) => m.role === 'user');
    const input =
      typeof lastUserMessage?.content === 'string'
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage?.content ?? '');

    const gc: GraphContext = {
      currentNode: this.graph.entry,
      nodeActive: false,
      store: {},
      backtrackCount: 0,
      visitCount: {},
      input,
    };

    this.saveGraphContext(state, gc);
    return this.startNode(gc, state);
  }

  /**
   * Start executing a graph node.
   *
   * - agent nodes: send task prompt WITH tools, WITHOUT JSON schema
   *   (let the agent use tools freely, extract structured output later)
   * - llm nodes: send prompt WITH JSON schema, WITHOUT tools
   *   (single structured generation call)
   */
  private startNode(gc: GraphContext, state: AgentState): AgentInstruction {
    const node = this.graph.states[gc.currentNode];
    if (!node) {
      return {
        reason: 'error_recovery',
        reasonDetail: `Graph node "${gc.currentNode}" not found in states`,
        type: 'finish',
      };
    }

    const visits = (gc.visitCount[gc.currentNode] ?? 0) + 1;
    gc.visitCount[gc.currentNode] = visits;

    if (visits > 1) {
      gc.backtrackCount++;
    }

    const renderedPrompt = this.renderPrompt(node.prompt, gc);

    let fullPrompt: string;
    let tools: any[];

    if (node.type === 'agent') {
      // Agent node: task prompt with tools, no JSON schema constraint
      // The agent will use tools freely; structured output is extracted after the loop
      fullPrompt =
        renderedPrompt +
        '\n\nIMPORTANT: You MUST use your available tools (web search, etc.) to research this. ' +
        'Do NOT answer from memory. Search for real evidence and data first, ' +
        'then provide your findings based on the tool results.';
      tools = state.tools ?? [];
    } else {
      // LLM node: structured output, no tools
      fullPrompt =
        renderedPrompt +
        `\n\nYou MUST respond with a JSON object that conforms to this schema:\n` +
        `\`\`\`json\n${JSON.stringify(node.outputSchema, null, 2)}\n\`\`\`\n` +
        `Only output valid JSON, no other text.`;
      tools = [];
    }

    gc.nodeActive = true;
    gc.extracting = false;
    this.saveGraphContext(state, gc);

    const messages = [...state.messages, { content: fullPrompt, role: 'user' as const }];

    const payload: GeneralAgentCallLLMInstructionPayload = {
      messages,
      model: state.modelRuntimeConfig?.model ?? '',
      provider: state.modelRuntimeConfig?.provider ?? '',
      tools,
    };

    return { payload, stepLabel: gc.currentNode, type: 'call_llm' };
  }

  /**
   * After an agent node's tool loop finishes, do an extra LLM call
   * to extract structured output from the conversation.
   */
  private startExtraction(state: AgentState, gc: GraphContext): AgentInstruction {
    const node = this.graph.states[gc.currentNode];

    const extractionPrompt =
      `Based on the research and information gathered above, ` +
      `extract and summarize your findings into a JSON object that conforms to this schema:\n` +
      `\`\`\`json\n${JSON.stringify(node.outputSchema, null, 2)}\n\`\`\`\n` +
      `Only output valid JSON, no other text.`;

    gc.extracting = true;
    this.saveGraphContext(state, gc);

    const messages = [...state.messages, { content: extractionPrompt, role: 'user' as const }];

    const payload: GeneralAgentCallLLMInstructionPayload = {
      messages,
      model: state.modelRuntimeConfig?.model ?? '',
      provider: state.modelRuntimeConfig?.provider ?? '',
      tools: [], // No tools for extraction
    };

    return { payload, stepLabel: `${gc.currentNode}:extract`, type: 'call_llm' };
  }

  /**
   * Called when a node completes. Extract output, eval transitions, advance graph.
   */
  private onNodeComplete(state: AgentState, gc: GraphContext): AgentInstruction {
    const currentNodeId = gc.currentNode;

    const output = this.extractStructuredOutput(state);
    gc.store[currentNodeId] = output;
    gc.nodeActive = false;

    // Terminal node → done
    if (currentNodeId === this.graph.terminal) {
      this.saveGraphContext(state, gc);
      return {
        reason: 'completed',
        reasonDetail: `Graph "${this.graph.name}" completed at terminal node "${currentNodeId}"`,
        type: 'finish',
      };
    }

    // Evaluate transitions
    const nextNodeId = this.evaluateTransitions(gc, currentNodeId, output);

    if (!nextNodeId) {
      this.saveGraphContext(state, gc);
      return {
        reason: 'error_recovery',
        reasonDetail: `No valid transition from node "${currentNodeId}"`,
        type: 'finish',
      };
    }

    // Move to next node
    gc.currentNode = nextNodeId;

    // If backtracking, clear intermediate store entries
    const nodeKeys = Object.keys(this.graph.states);
    const fromIdx = nodeKeys.indexOf(currentNodeId);
    const toIdx = nodeKeys.indexOf(nextNodeId);
    if (toIdx < fromIdx) {
      for (let i = toIdx; i <= fromIdx; i++) {
        delete gc.store[nodeKeys[i]];
      }
    }

    this.saveGraphContext(state, gc);
    return this.startNode(gc, state);
  }

  private evaluateTransitions(
    gc: GraphContext,
    currentNodeId: string,
    output: Record<string, any>,
  ): string | null {
    const backtrackLimitReached = gc.backtrackCount >= this.graph.maxBacktracks;

    for (const t of this.graph.transitions) {
      if (t.from !== currentNodeId) continue;
      try {
        const result = new Function('output', `return (${t.condition})`)(output);
        if (result) {
          // If the transition target is a backtrack (already visited), only allow it
          // when within the backtrack limit. Otherwise fall through to linear advance.
          const isBacktrack = (gc.visitCount[t.to] ?? 0) > 0;
          if (isBacktrack && backtrackLimitReached) continue;
          return t.to;
        }
      } catch {
        // condition eval failed, skip
      }
    }

    return this.getNextState(currentNodeId);
  }

  private getNextState(currentNodeId: string): string | null {
    const keys = Object.keys(this.graph.states);
    const idx = keys.indexOf(currentNodeId);
    return idx >= 0 && idx + 1 < keys.length ? keys[idx + 1] : null;
  }

  private renderPrompt(template: string, gc: GraphContext): string {
    return template.replaceAll(/\{\{(\w+)\.(\w+)\}\}/g, (_, stateId, field) => {
      if (stateId === 'input' && field === 'question') {
        return gc.input;
      }

      const data = gc.store[stateId];
      if (!data) return `(${stateId} has no data yet)`;
      const val = data[field];
      if (val === undefined) return `(${stateId}.${field} has no data)`;
      return typeof val === 'string' ? val : JSON.stringify(val, null, 2);
    });
  }

  private extractStructuredOutput(state: AgentState): Record<string, any> {
    const lastAssistantMessage = [...state.messages]
      .reverse()
      .find((m: any) => m.role === 'assistant');

    if (!lastAssistantMessage) return {};

    const content =
      typeof lastAssistantMessage.content === 'string' ? lastAssistantMessage.content : '';

    // Extract JSON from markdown code blocks or raw content
    const fenceStart = content.indexOf('```');
    let jsonStr: string;
    if (fenceStart !== -1) {
      const contentAfterFence = content.slice(fenceStart + 3);
      // Skip optional language tag (e.g. "json\n")
      const newlineIdx = contentAfterFence.indexOf('\n');
      const bodyStart = newlineIdx !== -1 ? newlineIdx + 1 : 0;
      const fenceEnd = contentAfterFence.indexOf('```', bodyStart);
      jsonStr = (
        fenceEnd !== -1
          ? contentAfterFence.slice(bodyStart, fenceEnd)
          : contentAfterFence.slice(bodyStart)
      ).trim();
    } else {
      jsonStr = content.trim();
    }

    try {
      return JSON.parse(jsonStr);
    } catch {
      return { _raw: content };
    }
  }

  private getGraphContext(state: AgentState): GraphContext | null {
    return (state.metadata?.[GRAPH_CONTEXT_KEY] as GraphContext) ?? null;
  }

  private saveGraphContext(state: AgentState, gc: GraphContext): void {
    if (!state.metadata) state.metadata = {};
    state.metadata[GRAPH_CONTEXT_KEY] = gc;
  }
}

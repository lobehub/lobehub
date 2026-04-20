// ── Reasoning Graph Definition (declarative JSON) ──

/**
 * A single state node in the reasoning graph
 */
export interface StateNode {
  /**
   * JSON Schema for structured output. Forces LLM to produce conforming JSON.
   */
  outputSchema: Record<string, any>;
  /**
   * Prompt template. Use {{stateId.field}} to reference output fields from previous nodes.
   * Special variable: {{input.question}} references the original user input.
   */
  prompt: string;
  /**
   * Node type:
   * - 'agent': Has tool capabilities, delegates to GeneralChatAgent for multi-turn tool loop
   * - 'llm': Pure generation, single LLM call with structured output
   */
  type: 'agent' | 'llm';
}

/**
 * A transition rule between states
 */
export interface Transition {
  /**
   * JS expression evaluated programmatically (NOT by LLM).
   * The `output` variable is injected with the current node's structured output.
   * Example: 'output.confidence < 0.4 && output.falsified.length > 0'
   */
  condition: string;
  from: string;
  to: string;
}

/**
 * Declarative reasoning graph definition.
 * Drives multi-stage agent execution with programmatic flow control.
 */
export interface ReasoningGraph {
  description?: string;
  /** Entry node ID */
  entry: string;
  /** Maximum backtrack count before forcing forward progress */
  maxBacktracks: number;
  name: string;
  /** State node definitions */
  states: Record<string, StateNode>;
  /** Terminal node ID — when this node finishes, the entire graph is done */
  terminal: string;
  /** Transition rules, evaluated in order — first match wins */
  transitions: Transition[];
}

// ── Graph Runtime Context ──

/**
 * Runtime context maintained by GraphAgent across steps.
 * Stored in AgentState.metadata to survive across runner() calls.
 */
export interface GraphContext {
  /** Total backtrack count across the graph execution */
  backtrackCount: number;
  /** Current node ID being executed */
  currentNode: string;
  /**
   * Whether an agent node is in the extraction phase.
   * After the agent loop finishes, an extra LLM call extracts structured output.
   */
  extracting?: boolean;
  /** The original user input/question */
  input: string;
  /**
   * Whether the current node's inner agent loop is active.
   * When true, phases like llm_result/tool_result are delegated to GeneralChatAgent.
   * When false, we're at a graph-level transition point.
   */
  nodeActive: boolean;
  /** Accumulated structured outputs from completed nodes: stateId → output */
  store: Record<string, Record<string, any>>;
  /** Visit count per node (for detecting backtracks) */
  visitCount: Record<string, number>;
}

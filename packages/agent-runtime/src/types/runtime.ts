import type { AgentEvent } from './event';
import type { AgentInstruction, AgentRuntimeContext } from './instruction';
import type { AgentState } from './state';

export type InstructionExecutor = (
  instruction: AgentInstruction,
  state: AgentState,
  /**
   * Runtime context for this step
   * Contains stepContext with dynamic state like GTD todos
   */
  context?: AgentRuntimeContext,
) => Promise<{
  events: AgentEvent[];
  newState: AgentState;
  /** Next context to pass to Agent runner (if execution should continue) */
  nextContext?: AgentRuntimeContext;
}>;

export interface RuntimeConfig {
  /** Custom executors for specific instruction types */
  executors?: Partial<Record<AgentInstruction['type'], InstructionExecutor>>;
  /** Function to get operation context and abort controller */
  getOperation?: (operationId: string) => {
    abortController: AbortController;
    context: Record<string, any>;
  };
  /** Operation ID for tracking this runtime instance */
  operationId?: string;
}

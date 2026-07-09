import type { AgentRuntimeHost, LLMCallExecuteInput } from '../transport';
import type { AgentInstruction, InstructionExecutor } from '../types';

interface LLMCallTransport {
  executeCall: (input: LLMCallExecuteInput) => ReturnType<InstructionExecutor>;
}

const requireLLMCallTransport = (host: AgentRuntimeHost) => {
  const llm = host.transports.llm;
  if (!llm?.executeCall) {
    throw new Error('LLMTransport.executeCall is required for call_llm executor');
  }
  return llm as NonNullable<AgentRuntimeHost['transports']['llm']> & LLMCallTransport;
};

/**
 * `call_llm` executor — transitional transport-backed entry point.
 *
 * The server-specific implementation still lives behind the LLM transport while
 * the remaining context/stream/persist internals are broken into package-owned
 * ports. This removes the direct server executor registration first, matching
 * the migration shape used by the other runtime executors.
 */
export const callLlm =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const llm = requireLLMCallTransport(host);
    return llm.executeCall({
      instruction: instruction as Extract<AgentInstruction, { type: 'call_llm' }>,
      state,
    });
  };

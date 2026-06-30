import type { BlobStore } from './blob';
import type { ContextBuilder } from './context';
import type { LifecycleSink } from './lifecycle';
import type { LLMTransport } from './llm';
import type { MessageTransport } from './message';
import type { StreamSink } from './stream';
import type { SubAgentTransport } from './subAgent';
import type { ToolTransport } from './tool';

/**
 * The injectable IO surface for the runtime executors.
 *
 * `messages` + `stream` are required (every executor touches them). The rest
 * are optional because only some executors need them — an executor that needs a
 * transport asserts its presence at use site:
 *
 *   - `tools`     → call_tool, call_tools_batch
 *   - `subAgent`  → exec_sub_agent, exec_sub_agents
 *   - `llm`       → call_llm, compress_context
 *   - `context`   → call_llm, compress_context
 *   - `blob`      → call_llm
 */
export interface RuntimeTransports {
  blob?: BlobStore;
  context?: ContextBuilder;
  llm?: LLMTransport;
  messages: MessageTransport;
  stream: StreamSink;
  subAgent?: SubAgentTransport;
  tools?: ToolTransport;
}

/**
 * Single argument to the (future) package-hosted executor factories. The server
 * builds this once per operation — wiring its adapters + lifecycle dispatcher —
 * and the package owns the executor logic. This is the seam that lets the same
 * executors run on server and client (LOBE-10949 end-state).
 */
export interface AgentRuntimeHost {
  lifecycle?: LifecycleSink;
  transports: RuntimeTransports;
}

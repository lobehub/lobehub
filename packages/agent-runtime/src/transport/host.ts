import type { BlobStore } from './blob';
import type { CompressionTransport } from './compression';
import type { ContextBuilder } from './context';
import type { LifecycleSink } from './lifecycle';
import type { LLMTransport } from './llm';
import type { MessageTransport } from './message';
import type { OperationStore, RuntimeOperationContext } from './operation';
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
 *   - `tools`          → call_tool, call_tools_batch
 *   - `subAgent`       → exec_sub_agent, exec_sub_agents
 *   - `compression`    → compress_context
 *   - `llm`            → call_llm, compress_context
 *   - `context`        → call_llm, compress_context
 *   - `blob`           → call_llm
 *   - `operationStore` → finish, call_llm (interruption guard)
 */
export interface RuntimeTransports {
  blob?: BlobStore;
  compression?: CompressionTransport;
  context?: ContextBuilder;
  llm?: LLMTransport;
  messages: MessageTransport;
  operationStore?: OperationStore;
  stream: StreamSink;
  subAgent?: SubAgentTransport;
  tools?: ToolTransport;
}

/**
 * Single argument to the package-hosted executor factories. The server
 * builds this once per operation — wiring its adapters + lifecycle dispatcher +
 * operation context — and the package owns the executor logic. This is the seam
 * that lets the same executors run on server and client (target end-state of the
 * agent-runtime IO transport port abstraction).
 */
export interface AgentRuntimeHost {
  lifecycle?: LifecycleSink;
  operation: RuntimeOperationContext;
  transports: RuntimeTransports;
}

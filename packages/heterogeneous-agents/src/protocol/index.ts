/**
 * Wire contract between hetero dispatch sites and the executing
 * `lh hetero exec` CLI. Pure and isomorphic — no fs, no process, no node-only
 * imports — so any dispatcher (desktop main, `lh connect` daemon, server
 * sandbox runner) can depend on it without dragging in the spawn machinery.
 *
 * Executor-side helpers that materialize this contract (`normalizeImage`,
 * `buildAgentInput`, `spawnAgent`, …) live under `./spawn` instead.
 */
export type {
  HeterogeneousAgentCancellationResult,
  HeterogeneousAgentCancellationSignal,
} from './cancellation';
export { buildHeteroExecStdinPayload, type HeteroExecImageRef } from './execStdinPayload';
export const HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV = 'LOBEHUB_HETERO_EXEC_INHERIT_PROCESS_GROUP';
export {
  buildHeterogeneousPrompt,
  type HeterogeneousPromptContextProvider,
  HeterogeneousPromptEngine,
  type HeterogeneousPromptEngineInput,
  type HeterogeneousPromptImage,
} from './promptEngine';
export type {
  AgentContentBlock,
  AgentImageBlock,
  AgentImageSource,
  AgentPromptInput,
  AgentTextBlock,
} from './types';

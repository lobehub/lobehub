/**
 * Producer-side helpers for converting external agent CLI output into the
 * unified `AgentStreamEvent` wire shape. Imported by:
 *   - Electron main (`HeterogeneousAgentCtr`) — desktop CC / Codex flow
 *   - The future `lh hetero exec` CLI — sandbox + terminal flow (LOBE-8516)
 *
 * Consumers (renderer executor, server `heteroIngest` handler) never need to
 * touch adapters — every event reaching them is already an `AgentStreamEvent`.
 *
 * `AgentStreamEvent` itself is re-exported here so producer-side callers
 * (desktop main, CLI sandbox) only depend on this package, not on
 * `@lobechat/agent-gateway-client` (which is a browser-side WebSocket client
 * that producers have no business pulling in).
 */
export { AgentStreamPipeline, type AgentStreamPipelineOptions } from './agentStreamPipeline';
export { type CliSpawnPlan, resolveCliSpawnPlan } from './cliSpawn';
export { CodexFileChangeTracker } from './codexFileChangeTracker';
export {
  type AgentContentBlock,
  type AgentImageBlock,
  type AgentImageSource,
  type AgentInputPlan,
  type AgentPromptInput,
  type AgentTextBlock,
  buildAgentInput,
  type BuildAgentInputOptions,
  materializeImageToPath,
  type NormalizedImage,
  normalizeImage,
  type NormalizeImageOptions,
} from './input';
export { JsonlStreamProcessor } from './jsonlProcessor';
export {
  CLAUDE_CODE_BASE_ARGS,
  spawnAgent,
  type SpawnAgentHandle,
  type SpawnAgentOptions,
} from './spawnAgent';
export { toStreamEvent } from './streamEvent';
export type { AgentStreamEvent, AgentStreamEventType } from '@lobechat/agent-gateway-client';

/**
 * Producer-side helpers for converting external agent CLI output into the
 * unified `AgentStreamEvent` wire shape. Imported by:
 *   - Electron main (`HeterogeneousAgentCtr`) — desktop CC / Codex flow
 *   - The future `lh hetero exec` CLI — sandbox + terminal flow ()
 *
 * Consumers (renderer executor, server `heteroIngest` handler) never need to
 * touch adapters — every event reaching them is already an `AgentStreamEvent`.
 *
 * `AgentStreamEvent` itself is re-exported here so producer-side callers
 * (desktop main, CLI sandbox) only depend on this package, not on
 * `@lobechat/agent-gateway-client` (which is a browser-side WebSocket client
 * that producers have no business pulling in).
 */
export type { UsageData } from '../types';
export {
  AgentStreamPipeline,
  type AgentStreamPipelineOptions,
  type UploadHeterogeneousImage,
} from './agentStreamPipeline';
export {
  classifyHeteroProcessFailure,
  type ClassifyHeteroProcessFailureParams,
  isHeteroStatusGuideErrorData,
} from './classifyProcessFailure';
export {
  buildClaudeSdkUserMessageFromStreamJson,
  ClaudeAgentSdkSession,
  type ClaudeAgentSdkSessionOptions,
  type HeterogeneousAgentRuntimeState,
  type HeterogeneousAgentRuntimeStatus,
  type HeterogeneousAgentRuntimeTask,
} from './claudeAgentSdkSession';
export { type CliSpawnPlan, resolveCliSpawnPlan } from './cliSpawn';
export { CodexFileChangeTracker } from './codexFileChangeTracker';
export {
  type CodexInitialModelResolution,
  type CodexInitialModelSource,
  type CodexSessionModelInfo,
  getCodexHome,
  parseCodexModelFromArgs,
  parseCodexProfileFromArgs,
  readCodexSessionModel,
  resolveCodexInitialModel,
} from './codexModel';
export {
  createFileStoreImageUploader,
  type FileStoreCreateFileInput,
  type FileStorePort,
} from './fileStoreImageUploader';
export {
  type AgentContentBlock,
  type AgentImageBlock,
  type AgentImageSource,
  type AgentInputPlan,
  type AgentPromptInput,
  type AgentTextBlock,
  buildAgentInput,
  type BuildAgentInputOptions,
  buildHeteroExecStdinPayload,
  type HeteroExecImageRef,
  materializeImageToPath,
  type NormalizedImage,
  normalizeImage,
  type NormalizeImageOptions,
} from './input';
export { JsonlStreamProcessor } from './jsonlProcessor';
// NOTE: `resolveCliCommand` is intentionally NOT re-exported here. It runs
// `promisify(execFile)` at module load, which throws under a partial
// `node:child_process` mock — and this barrel is widely imported (e.g. for
// `resolveCliSpawnPlan`), so pulling it in would break unrelated suites at
// import time. Import it from the dedicated `@lobechat/heterogeneous-agents/
// resolveCliCommand` subpath instead.
export {
  AMP_BASE_ARGS,
  CLAUDE_CODE_BASE_ARGS,
  CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG,
  CODEX_DEFAULT_EXECUTION_ARGS,
  CODEX_EXECUTION_MODE_FLAGS,
  CODEX_REQUIRED_ARGS,
  spawnAgent,
  type SpawnAgentHandle,
  type SpawnAgentOptions,
} from './spawnAgent';
export { toStreamEvent } from './streamEvent';
export type { AgentStreamEvent, AgentStreamEventType } from '@lobechat/agent-gateway-client';

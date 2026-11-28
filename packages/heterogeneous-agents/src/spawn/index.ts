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
  ACP_PROTOCOL_VERSION,
  AcpAgentSession,
  type AcpAgentSessionConfig,
  type AcpAgentSessionOptions,
  type AcpPermissionOption,
  parseAcpPermissionOptions,
  selectAcpPermissionOption,
} from './acp/agentSession';
export {
  type AntigravityAcpPromptBlock,
  AntigravityAcpSession,
  type AntigravityAcpSessionOptions,
  buildAntigravityAcpPrompt,
  isAntigravityAcpSessionNotFoundError,
} from './acp/antigravity/session';
export {
  type AntigravityAcpLaunch,
  buildAntigravityAcpLaunch,
  getAntigravitySpawnEnv,
} from './acp/antigravity/spawnEnv';
export {
  buildCopilotAcpArgs,
  buildCopilotAcpPrompt,
  type CopilotAcpImagePromptBlock,
  type CopilotAcpModelCatalog,
  type CopilotAcpPromptBlock,
  CopilotAcpSession,
  type CopilotAcpSessionOptions,
  type CopilotAcpTextPromptBlock,
  isCopilotAcpSessionNotFoundError,
  listCopilotAcpModels,
  type ListCopilotAcpModelsOptions,
  parseCopilotAcpModelCatalog,
} from './acp/copilotSession';
export {
  buildCursorAcpArgs,
  buildCursorAcpPrompt,
  CursorAcpSession,
  type CursorAcpSessionOptions,
  type CursorAcpTextPromptBlock,
  isCursorAcpSessionNotFoundError,
  normalizeCursorQuestion,
} from './acp/cursorSession';
export {
  buildDevinAcpArgs,
  buildDevinAcpPrompt,
  type DevinAcpImagePromptBlock,
  type DevinAcpPromptBlock,
  DevinAcpSession,
  type DevinAcpSessionOptions,
  type DevinAcpTextPromptBlock,
  isDevinAcpSessionNotFoundError,
} from './acp/devinSession';
export {
  buildDroidAcpArgs,
  buildDroidAcpPrompt,
  type DroidAcpImagePromptBlock,
  type DroidAcpModelCatalog,
  type DroidAcpPromptBlock,
  DroidAcpSession,
  type DroidAcpSessionOptions,
  type DroidAcpTextPromptBlock,
  isDroidAcpSessionNotFoundError,
  listDroidAcpModels,
  type ListDroidAcpModelsOptions,
  parseDroidAcpModelCatalog,
} from './acp/droidSession';
export {
  detectDshCommand,
  DSH_ACP_PROFILE_ARGS,
  DSH_COMMAND,
  DSH_MIN_VERSION,
  DSH_VERSION_PATTERN,
  DshAcpSession,
  type DshAcpSessionHandle,
  type DshAcpSessionOptions,
  resolveDshSpawnCommand,
  spawnDshAcpSession,
  type SpawnDshAcpSessionOptions,
} from './acp/dsh/session';
export {
  buildGrokAcpArgs,
  buildGrokAcpPrompt,
  type GrokAcpContentBlock,
  GrokAcpSession,
  type GrokAcpSessionOptions,
} from './acp/grokBuildSession';
export {
  type AcpRpcErrorData,
  type AcpRpcMessage,
  AcpRpcResponseError,
  AcpServerRequestError,
  AcpStdioClient,
  type AcpStdioClientOptions,
} from './acp/stdioClient';
export {
  AgentStreamPipeline,
  type AgentStreamPipelineOptions,
  type UploadHeterogeneousImage,
} from './agentStreamPipeline';
export {
  classifyHeteroProcessFailure,
  type ClassifyHeteroProcessFailureParams,
  HETERO_WORKING_DIRECTORY_NOT_FOUND,
  isHeteroStatusGuideErrorData,
} from './classifyProcessFailure';
export {
  buildClaudeSdkUserMessageFromStreamJson,
  ClaudeAgentSdkSession,
  type ClaudeAgentSdkSessionOptions,
  type HeterogeneousAgentRuntimeState,
  type HeterogeneousAgentRuntimeStatus,
  type HeterogeneousAgentRuntimeTask,
} from './claudeCode/agentSdkSession';
export { type CliSpawnPlan, resolveCliSpawnPlan } from './cliSpawn';
export {
  buildCodexAppServerArgs,
  buildCodexAppServerInput,
  buildCodexAppServerThreadParams,
  type CodexAgentHandleOptions,
  CodexAppServerClient,
  type CodexAppServerClientOptions,
  CodexAppServerConnectionError,
  CodexAppServerRpcError,
  CodexThreadSession,
  type CodexThreadSessionOptions,
  createCodexAgentHandle,
  getCodexAppServerUnsupportedArgs,
  isCodexAppServerCompatibilityError,
  pickCodexRunProvenance,
} from './codex/appServer';
export { CodexFileChangeTracker } from './codex/fileChangeTracker';
export {
  type CodexInitialModelResolution,
  type CodexInitialModelSource,
  type CodexSessionModelInfo,
  getCodexHome,
  parseCodexModelFromArgs,
  parseCodexProfileFromArgs,
  readCodexSessionModel,
  resolveCodexInitialModel,
} from './codex/model';
export {
  buildCodexLobeHubContextArgs,
  buildCodexShellEnvSetArgs,
  CODEX_LOBEHUB_CONTEXT_ENV_KEYS,
  type CodexJwtFile,
  createCodexJwtFile,
  LOBEHUB_JWT_FILE_ENV,
  refreshCodexJwtFiles,
  toTomlBasicString,
} from './codex/shellEnv';
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
export {
  buildLobeHubCliPluginFiles,
  CLAUDE_CODE_PLUGIN_SKILLS_MIN_VERSION,
  claudeCodeLoadsPluginSkills,
  type ClaudeCodeLobeHubCliDelivery,
  LOBEHUB_CLI_PLUGIN_NAME,
  LOBEHUB_CLI_SKILL_NAME,
  omitLobeHubCliGuide,
  prepareClaudeCodeLobeHubCli,
  resolveLobeHubCliPluginDir,
} from './lobeHubCliPlugin';
// NOTE: `resolveCliCommand` is intentionally NOT re-exported here. It runs
// `promisify(execFile)` at module load, which throws under a partial
// `node:child_process` mock — and this barrel is widely imported (e.g. for
// `resolveCliSpawnPlan`), so pulling it in would break unrelated suites at
// import time. Import it from the dedicated `@lobechat/heterogeneous-agents/
// resolveCliCommand` subpath instead.
export {
  buildTraeAcpArgs,
  buildTraeAcpPrompt,
  type TraeAcpImagePromptBlock,
  type TraeAcpPromptBlock,
  TraeAcpSession,
  type TraeAcpSessionOptions,
  type TraeAcpTextPromptBlock,
} from './acp/traeSession';
export {
  buildClaudeCodeDirectEnv,
  type BuildClaudeCodeDirectEnvInput,
  type BuildClaudeCodeDirectEnvResult,
  normalizeAnthropicSdkBaseURL,
  sanitizeClaudeCodeDirectArgs,
  sanitizeClaudeCodeDirectEnv,
} from './claudeCode/directEnv';
export {
  type ClaudeCodeControlRequest,
  type ClaudeCodeControlRequestHandle,
  type ClaudeCodeControlResponse,
  type ClaudeCodeLiveExit,
  ClaudeCodeLiveInput,
  resolveClaudeCodeLiveRuntimeEnd,
} from './claudeCode/liveInput';
export { readClaudeCodeSessionCost } from './claudeCode/sessionCost';
export { STOP_TASK_ANSWER_TIMEOUT_MS, stopClaudeCodeTask } from './claudeCode/stopTask';
export {
  ensureClaudeCodeResumeTranscript,
  type EnsureResumeTranscriptReason,
  type EnsureResumeTranscriptResult,
  findClaudeCodeTranscriptPath,
  resolveClaudeCodeTranscriptPath,
} from './ensureResumeTranscript';
export { getHeterogeneousAgentSpawnEnv } from './presetEnv';
export {
  AMP_BASE_ARGS,
  buildQoderArgs,
  CLAUDE_CODE_BASE_ARGS,
  CODEBUDDY_BASE_ARGS,
  CODEX_BYPASS_APPROVALS_AND_SANDBOX_ARG,
  CODEX_DEFAULT_EXECUTION_ARGS,
  CODEX_EXECUTION_MODE_FLAGS,
  CODEX_REQUIRED_ARGS,
  KIMI_CODE_BASE_ARGS,
  OPENCODE_BASE_ARGS,
  QODER_BASE_ARGS,
  type QoderSpawnArgsOptions,
  spawnAgent,
  type SpawnAgentHandle,
  type SpawnAgentOptions,
  spawnTraeAcpAgent,
} from './spawnAgent';
export { toStreamEvent } from './streamEvent';
export type { AgentStreamEvent, AgentStreamEventType } from '@lobechat/agent-gateway-client';

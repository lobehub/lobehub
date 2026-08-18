// GENERATED CODE! DO NOT MODIFY BY HAND!

// Bundled from `codex app-server generate-ts` output. See README.md.

// Source: AbsolutePathBuf.ts
/**
 * A path that is guaranteed to be absolute and normalized (though it is not
 * guaranteed to be canonicalized or exist on the filesystem).
 *
 * IMPORTANT: When deserializing an `AbsolutePathBuf`, a base path must be set
 * using [AbsolutePathBufGuard::new]. If no base path is set, the
 * deserialization will fail unless the path being deserialized is already
 * absolute.
 */
export type AbsolutePathBuf = string;

// Source: AgentPath.ts
export type AgentPath = string;

// Source: ClientInfo.ts
export type ClientInfo = { name: string, title: string | null, version: string, };

// Source: ClientNotification.ts
export type ClientNotification = { "method": "initialized" };

// Source: ImageDetail.ts
export type ImageDetail = "auto" | "low" | "high" | "original";

// Source: ImageGenerationFailure.ts
export type ImageGenerationFailure = { "type": "usageLimitExceeded", limitId: string, resetsAt: number | null, };

// Source: ImageGenerationItem.ts
export type ImageGenerationItem = { id: string, status: string, revisedPrompt: string | null, result: string, transparentBackground?: boolean, failure: ImageGenerationFailure | null, savedPath?: AbsolutePathBuf, };

// Source: InitializeCapabilities.ts
/**
 * Client-declared capabilities negotiated during initialize.
 */
export type InitializeCapabilities = {
/**
 * Opt into receiving experimental API methods and fields.
 */
experimentalApi: boolean,
/**
 * Opt into `attestation/generate` requests for upstream `x-oai-attestation`.
 */
requestAttestation: boolean,
/**
 * Legacy opt-in for the `openai/form` MCP extension.
 *
 * New clients should declare `openai/form` in [`Self::extensions`].
 */
mcpServerOpenaiFormElicitation?: boolean,
/**
 * Exact notification method names that should be suppressed for this
 * connection (for example `thread/started`).
 */
optOutNotificationMethods?: Array<string> | null,
/**
 * MCP extension settings declared by the app-server client.
 */
extensions?: { [key in string]?: JsonValue } | null, };

// Source: InitializeParams.ts
export type InitializeParams = { clientInfo: ClientInfo, capabilities: InitializeCapabilities | null, };

// Source: InitializeResponse.ts
export type InitializeResponse = { userAgent: string,
/**
 * Absolute path to the server's $CODEX_HOME directory.
 */
codexHome: AbsolutePathBuf,
/**
 * Platform family for the running app-server target, for example
 * `"unix"` or `"windows"`.
 */
platformFamily: string,
/**
 * Operating system for the running app-server target, for example
 * `"macos"`, `"linux"`, or `"windows"`.
 */
platformOs: string, };

// Source: LegacyAppPathString.ts
/**
 * A UTF-8 path for preserving raw path compatibility at the app-server API
 * boundary while Codex migrates to [`PathUri`].
 *
 * Supports storing arbitrary strings read from the API and converting to and
 * from [`PathUri`] using an explicitly selected native path convention.
 *
 * When converting from [`PathUri`], "native" refers to the supplied
 * [`PathConvention`], which may be foreign to the operating system running
 * this process. The inner string is private so path-producing code must use a
 * path conversion method instead of bypassing the intended conversion
 * boundary. Non-UTF-8 paths are converted to UTF-8 lossily because this API
 * value is serialized as a JSON string.
 *
 * Deserialization and [`Self::from_string`] accept any UTF-8 string without
 * interpreting or validating it. Use [`Self::from_string`] when a caller
 * already owns legacy app-server path text and needs to preserve its wire
 * spelling; use [`Self::from_path`], [`Self::from_abs_path`], or
 * [`Self::from_path_uri`] when converting an actual path value. Relative
 * path text remains valid until an operation such as [`Self::to_path_uri`]
 * requires an absolute path.
 */
export type LegacyAppPathString = string;

// Source: MessagePhase.ts
/**
 * Classifies an assistant message as interim commentary or final answer text.
 *
 * Providers do not emit this consistently, so callers must treat `None` as
 * "phase unknown" and keep compatibility behavior for legacy models.
 */
export type MessagePhase = "commentary" | "final_answer";

// Source: Personality.ts
export type Personality = "none" | "friendly" | "pragmatic";

// Source: ReasoningEffort.ts
/**
 * See https://platform.openai.com/docs/guides/reasoning?api-mode=responses#get-started-with-reasoning
 */
export type ReasoningEffort = string;

// Source: ReasoningSummary.ts
/**
 * A summary of the reasoning performed by the model. This can be useful for
 * debugging and understanding the model's reasoning process.
 * See https://platform.openai.com/docs/guides/reasoning?api-mode=responses#reasoning-summaries
 */
export type ReasoningSummary = "auto" | "concise" | "detailed" | "none";

// Source: RequestId.ts
export type RequestId = string | number;

// Source: SleepItem.ts
/**
 * Display item emitted by the interruptible `clock.sleep` tool.
 */
export type SleepItem = { id: string, durationMs: number, };

// Source: SubAgentSource.ts
export type SubAgentSource = "review" | "compact" | { "thread_spawn": { parent_thread_id: ThreadId, depth: number, agent_path: AgentPath | null, agent_nickname: string | null, agent_role: string | null, } } | "memory_consolidation" | { "other": string };

// Source: ThreadId.ts
/**
 * Identifier for a Codex thread.
 *
 * Codex-generated thread IDs are UUIDv7, and some use cases rely on that.
 */
export type ThreadId = string;

// Source: WebSearchItem.ts
export type WebSearchItem = { id: string, query: string, action: WebSearchAction | null,
/**
 * Structured search results returned out-of-band by standalone web search.
 *
 * These stay as opaque JSON at the extension/app-server boundary so new
 * result fields and result types can pass through without a Codex release.
 */
results: Array<JsonValue> | null, };

// Source: serde_json/JsonValue.ts
export type JsonValue = number | string | boolean | Array<JsonValue> | { [key in string]?: JsonValue } | null;

// Source: v2/AgentMessageDeltaNotification.ts
export type AgentMessageDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, };

// Source: v2/ApprovalsReviewer.ts
/**
 * Configures who approval requests are routed to for review. Examples
 * include sandbox escapes, blocked network access, MCP approval prompts, and
 * ARC escalations. Defaults to `user`. `auto_review` uses a carefully
 * prompted subagent to gather relevant context and apply a risk-based
 * decision framework before approving or denying the request.
 */
export type ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";

// Source: v2/AskForApproval.ts
export type AskForApproval = "untrusted" | "on-request" | { "granular": { sandbox_approval: boolean, rules: boolean, skill_approval: boolean, request_permissions: boolean, mcp_elicitations: boolean, } } | "never";

// Source: v2/ByteRange.ts
export type ByteRange = { start: number, end: number, };

// Source: v2/CodexErrorInfo.ts
/**
 * This translation layer make sure that we expose codex error code in camel case.
 *
 * When an upstream HTTP status is available (for example, from the Responses API or a provider),
 * it is forwarded in `httpStatusCode` on the relevant `codexErrorInfo` variant.
 */
export type CodexErrorInfo = "contextWindowExceeded" | "sessionBudgetExceeded" | "usageLimitExceeded" | "serverOverloaded" | "cyberPolicy" | { "httpConnectionFailed": { httpStatusCode: number | null, } } | { "responseStreamConnectionFailed": { httpStatusCode: number | null, } } | "internalServerError" | "unauthorized" | "badRequest" | "threadRollbackFailed" | "sandboxError" | { "responseStreamDisconnected": { httpStatusCode: number | null, } } | { "responseTooManyFailedAttempts": { httpStatusCode: number | null, } } | { "activeTurnNotSteerable": { turnKind: NonSteerableTurnKind, } } | "other";

// Source: v2/CollabAgentState.ts
export type CollabAgentState = { status: CollabAgentStatus, message: string | null, };

// Source: v2/CollabAgentStatus.ts
export type CollabAgentStatus = "pendingInit" | "running" | "interrupted" | "completed" | "errored" | "shutdown" | "notFound";

// Source: v2/CollabAgentTool.ts
export type CollabAgentTool = "spawnAgent" | "sendInput" | "resumeAgent" | "wait" | "closeAgent";

// Source: v2/CollabAgentToolCallStatus.ts
export type CollabAgentToolCallStatus = "inProgress" | "completed" | "failed";

// Source: v2/CommandAction.ts
export type CommandAction = { "type": "read", command: string, name: string, path: LegacyAppPathString, } | { "type": "listFiles", command: string, path: string | null, } | { "type": "search", command: string, query: string | null, path: string | null, } | { "type": "unknown", command: string, };

// Source: v2/CommandExecutionOutputDeltaNotification.ts
export type CommandExecutionOutputDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, };

// Source: v2/CommandExecutionRequestApprovalParams.ts
export type CommandExecutionRequestApprovalParams = {threadId: string, turnId: string, itemId: string, /**
 * Unix timestamp (in milliseconds) when this approval request started.
 */
startedAtMs: number, /**
 * Unique identifier for this specific approval callback.
 *
 * For regular shell/unified_exec approvals, this is null.
 *
 * For zsh-exec-bridge subcommand approvals, multiple callbacks can belong to
 * one parent `itemId`, so `approvalId` is a distinct opaque callback id
 * (a UUID) used to disambiguate routing.
 */
approvalId?: string | null, /**
 * Environment in which the command will run.
 */
environmentId: string | null, /**
 * Optional explanatory reason (e.g. request for network access).
 */
reason?: string | null, /**
 * Optional context for a managed-network approval prompt.
 */
networkApprovalContext?: NetworkApprovalContext | null, /**
 * The command to be executed.
 */
command?: string | null, /**
 * The command's working directory.
 */
cwd?: LegacyAppPathString | null, /**
 * Best-effort parsed command actions for friendly display.
 */
commandActions?: Array<CommandAction> | null, /**
 * Optional proposed execpolicy amendment to allow similar commands without prompting.
 */
proposedExecpolicyAmendment?: ExecPolicyAmendment | null, /**
 * Optional proposed network policy amendments (allow/deny host) for future requests.
 */
proposedNetworkPolicyAmendments?: Array<NetworkPolicyAmendment> | null};

// Source: v2/CommandExecutionSource.ts
export type CommandExecutionSource = "agent" | "userShell" | "unifiedExecStartup" | "unifiedExecInteraction";

// Source: v2/CommandExecutionStatus.ts
export type CommandExecutionStatus = "inProgress" | "completed" | "failed" | "declined";

// Source: v2/DynamicToolCallOutputContentItem.ts
export type DynamicToolCallOutputContentItem = { "type": "inputText", text: string, } | { "type": "inputImage", imageUrl: string, } | { "type": "inputAudio", audioUrl: string, };

// Source: v2/DynamicToolCallStatus.ts
export type DynamicToolCallStatus = "inProgress" | "completed" | "failed";

// Source: v2/ErrorNotification.ts
export type ErrorNotification = { error: TurnError, willRetry: boolean, threadId: string, turnId: string, };

// Source: v2/ExecPolicyAmendment.ts
export type ExecPolicyAmendment = Array<string>;

// Source: v2/FileChangePatchUpdatedNotification.ts
export type FileChangePatchUpdatedNotification = { threadId: string, turnId: string, itemId: string, changes: Array<FileUpdateChange>, };

// Source: v2/FileChangeRequestApprovalParams.ts
export type FileChangeRequestApprovalParams = { threadId: string, turnId: string, itemId: string,
/**
 * Unix timestamp (in milliseconds) when this approval request started.
 */
startedAtMs: number,
/**
 * Optional explanatory reason (e.g. request for extra write access).
 */
reason?: string | null,
/**
 * [UNSTABLE] When set, the agent is asking the user to allow writes under this root
 * for the remainder of the session (unclear if this is honored today).
 */
grantRoot?: string | null, };

// Source: v2/FileUpdateChange.ts
export type FileUpdateChange = { path: string, kind: PatchChangeKind, diff: string, };

// Source: v2/GitInfo.ts
export type GitInfo = { sha: string | null, branch: string | null, originUrl: string | null, };

// Source: v2/HookPromptFragment.ts
export type HookPromptFragment = { text: string, hookRunId: string, };

// Source: v2/ItemCompletedNotification.ts
export type ItemCompletedNotification = { item: ThreadItem, threadId: string, turnId: string,
/**
 * Unix timestamp (in milliseconds) when this item lifecycle completed.
 */
completedAtMs: number, };

// Source: v2/ItemStartedNotification.ts
export type ItemStartedNotification = { item: ThreadItem, threadId: string, turnId: string,
/**
 * Unix timestamp (in milliseconds) when this item lifecycle started.
 */
startedAtMs: number, };

// Source: v2/McpToolCallAppContext.ts
export type McpToolCallAppContext = { connectorId: string, linkId: string | null, resourceUri: string | null, appName: string | null, actionName: string | null, };

// Source: v2/McpToolCallError.ts
export type McpToolCallError = { message: string, };

// Source: v2/McpToolCallProgressNotification.ts
export type McpToolCallProgressNotification = { threadId: string, turnId: string, itemId: string, message: string, };

// Source: v2/McpToolCallResult.ts
export type McpToolCallResult = { content: Array<JsonValue>, structuredContent: JsonValue | null, _meta: JsonValue | null, };

// Source: v2/McpToolCallStatus.ts
export type McpToolCallStatus = "inProgress" | "completed" | "failed";

// Source: v2/MemoryCitation.ts
export type MemoryCitation = { entries: Array<MemoryCitationEntry>, threadIds: Array<string>, };

// Source: v2/MemoryCitationEntry.ts
export type MemoryCitationEntry = { path: string, lineStart: number, lineEnd: number, note: string, };

// Source: v2/NetworkAccess.ts
export type NetworkAccess = "restricted" | "enabled";

// Source: v2/NetworkApprovalContext.ts
export type NetworkApprovalContext = { host: string, protocol: NetworkApprovalProtocol, };

// Source: v2/NetworkApprovalProtocol.ts
export type NetworkApprovalProtocol = "http" | "https" | "socks5Tcp" | "socks5Udp";

// Source: v2/NetworkPolicyAmendment.ts
export type NetworkPolicyAmendment = { host: string, action: NetworkPolicyRuleAction, };

// Source: v2/NetworkPolicyRuleAction.ts
export type NetworkPolicyRuleAction = "allow" | "deny";

// Source: v2/NonSteerableTurnKind.ts
export type NonSteerableTurnKind = "review" | "compact";

// Source: v2/PatchApplyStatus.ts
export type PatchApplyStatus = "inProgress" | "completed" | "failed" | "declined";

// Source: v2/PatchChangeKind.ts
export type PatchChangeKind = { "type": "add" } | { "type": "delete" } | { "type": "update", move_path: string | null, };

// Source: v2/ReasoningSummaryPartAddedNotification.ts
export type ReasoningSummaryPartAddedNotification = { threadId: string, turnId: string, itemId: string, summaryIndex: number, };

// Source: v2/ReasoningSummaryTextDeltaNotification.ts
export type ReasoningSummaryTextDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, summaryIndex: number, };

// Source: v2/ReasoningTextDeltaNotification.ts
export type ReasoningTextDeltaNotification = { threadId: string, turnId: string, itemId: string, delta: string, contentIndex: number, };

// Source: v2/SandboxMode.ts
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

// Source: v2/SandboxPolicy.ts
export type SandboxPolicy = { "type": "dangerFullAccess" } | { "type": "readOnly", networkAccess: boolean, } | { "type": "externalSandbox", networkAccess: NetworkAccess, } | { "type": "workspaceWrite", writableRoots: Array<AbsolutePathBuf>, networkAccess: boolean, excludeTmpdirEnvVar: boolean, excludeSlashTmp: boolean, };

// Source: v2/SessionSource.ts
export type SessionSource = "cli" | "vscode" | "exec" | "appServer" | { "custom": string } | { "subAgent": SubAgentSource } | "unknown";

// Source: v2/SubAgentActivityKind.ts
export type SubAgentActivityKind = "started" | "interacted" | "interrupted";

// Source: v2/TextElement.ts
export type TextElement = {
/**
 * Byte range in the parent `text` buffer that this element occupies.
 */
byteRange: ByteRange,
/**
 * Optional human-readable placeholder for the element, displayed in the UI.
 */
placeholder: string | null, };

// Source: v2/Thread.ts
export type Thread = {/**
 * Identifier for this thread. Codex-generated thread IDs are UUIDv7.
 */
id: string, /**
 * Session id shared by threads that belong to the same session tree.
 */
sessionId: string, /**
 * Source thread id when this thread was created by forking another thread.
 */
forkedFromId: string | null, /**
 * The ID of the parent thread. This will only be set if this thread is a subagent.
 */
parentThreadId: string | null, /**
 * Usually the first user message in the thread, if available.
 */
preview: string, /**
 * Whether the thread is ephemeral and should not be materialized on disk.
 */
ephemeral: boolean, /**
 * The independently persisted section selected for this thread, if any.
 */
section: ThreadSection | null, /**
 * Unix timestamp in seconds when the thread entered its current section.
 */
sectionEnteredAt: number | null, /**
 * Model provider used for this thread (for example, 'openai').
 */
modelProvider: string, /**
 * Unix timestamp (in seconds) when the thread was created.
 */
createdAt: number, /**
 * Unix timestamp (in seconds) when the thread was last updated.
 */
updatedAt: number, /**
 * Unix timestamp (in seconds) used for thread recency ordering.
 */
recencyAt: number | null, /**
 * Current runtime status for the thread.
 */
status: ThreadStatus, /**
 * [UNSTABLE] Path to the thread on disk.
 */
path: string | null, /**
 * Working directory captured for the thread.
 */
cwd: AbsolutePathBuf, /**
 * Version of the CLI that created the thread.
 */
cliVersion: string, /**
 * Origin of the thread (CLI, VSCode, codex exec, codex app-server, etc.).
 */
source: SessionSource, /**
 * Optional analytics source classification for this thread.
 */
threadSource: ThreadSource | null, /**
 * Optional random unique nickname assigned to an AgentControl-spawned sub-agent.
 */
agentNickname: string | null, /**
 * Optional role (agent_role) assigned to an AgentControl-spawned sub-agent.
 */
agentRole: string | null, /**
 * Optional Git metadata captured when the thread was created.
 */
gitInfo: GitInfo | null, /**
 * Optional user-facing thread title.
 */
name: string | null, /**
 * Only populated on `thread/resume`, `thread/rollback`, `thread/fork`, and `thread/read`
 * (when `includeTurns` is true) responses.
 * For all other responses and notifications returning a Thread,
 * the turns field will be an empty list.
 */
turns: Array<Turn>};

// Source: v2/ThreadActiveFlag.ts
export type ThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";

// Source: v2/ThreadItem.ts
export type ThreadItem = { "type": "userMessage", id: string, clientId: string | null, content: Array<UserInput>, } | { "type": "hookPrompt", id: string, fragments: Array<HookPromptFragment>, } | { "type": "agentMessage", id: string, text: string, phase: MessagePhase | null, memoryCitation: MemoryCitation | null, } | { "type": "plan", id: string, text: string, } | { "type": "reasoning", id: string, summary: Array<string>, content: Array<string>, } | { "type": "commandExecution", id: string,
/**
 * Trusted first-party plugin id when this command resolves to one plugin script.
 */
pluginId: string | null,
/**
 * Safe plugin-relative path when this command resolves to one plugin script.
 */
scriptPath: string | null,
/**
 * The command to be executed.
 */
command: string,
/**
 * The command's working directory.
 */
cwd: LegacyAppPathString,
/**
 * Identifier for the underlying PTY process (when available).
 */
processId: string | null, source: CommandExecutionSource, status: CommandExecutionStatus,
/**
 * A best-effort parsing of the command to understand the action(s) it will perform.
 * This returns a list of CommandAction objects because a single shell command may
 * be composed of many commands piped together.
 */
commandActions: Array<CommandAction>,
/**
 * The command's output, aggregated from stdout and stderr.
 */
aggregatedOutput: string | null,
/**
 * The command's exit code.
 */
exitCode: number | null,
/**
 * The duration of the command execution in milliseconds.
 */
durationMs: number | null, } | { "type": "fileChange", id: string, changes: Array<FileUpdateChange>, status: PatchApplyStatus, } | { "type": "mcpToolCall", id: string, server: string, tool: string, status: McpToolCallStatus, arguments: JsonValue, appContext: McpToolCallAppContext | null,
/**
 * Deprecated: use `appContext.resourceUri` instead.
 */
mcpAppResourceUri?: string, pluginId: string | null, readOnlyHint: boolean | null, result: McpToolCallResult | null, error: McpToolCallError | null,
/**
 * The duration of the MCP tool call in milliseconds.
 */
durationMs: number | null, } | { "type": "dynamicToolCall", id: string, namespace: string | null, tool: string, arguments: JsonValue, status: DynamicToolCallStatus, contentItems: Array<DynamicToolCallOutputContentItem> | null, success: boolean | null,
/**
 * The duration of the dynamic tool call in milliseconds.
 */
durationMs: number | null, } | { "type": "collabAgentToolCall",
/**
 * Unique identifier for this collab tool call.
 */
id: string,
/**
 * Name of the collab tool that was invoked.
 */
tool: CollabAgentTool,
/**
 * Current status of this collab tool call.
 */
status: CollabAgentToolCallStatus,
/**
 * Thread ID of the agent issuing the collab request.
 */
senderThreadId: string,
/**
 * Thread ID of the receiving agent, when applicable. In case of spawn operation,
 * this corresponds to the newly spawned agent.
 */
receiverThreadIds: Array<string>,
/**
 * Prompt text sent as part of the collab tool call, when available.
 */
prompt: string | null,
/**
 * Model requested for the spawned agent, when applicable.
 */
model: string | null,
/**
 * Reasoning effort requested for the spawned agent, when applicable.
 */
reasoningEffort: ReasoningEffort | null,
/**
 * Last known status of the target agents, when available.
 */
agentsStates: { [key in string]?: CollabAgentState }, } | { "type": "subAgentActivity", id: string, kind: SubAgentActivityKind, agentThreadId: string, agentPath: string, } | { "type": "webSearch" } & WebSearchItem | { "type": "imageView", id: string, path: LegacyAppPathString, } | { "type": "sleep" } & SleepItem | { "type": "imageGeneration" } & ImageGenerationItem | { "type": "enteredReviewMode", id: string, review: string, } | { "type": "exitedReviewMode", id: string, review: string, } | { "type": "contextCompaction", id: string, };

// Source: v2/ThreadSection.ts
/**
 * An independently persisted, user-visible thread section.
 */
export type ThreadSection = {
/**
 * Opaque UUIDv7 identity that remains stable when the section is renamed.
 */
id: string,
/**
 * The current user-visible section name.
 */
name: string,
/**
 * Optional appearance synchronized across clients.
 */
appearance: ThreadSectionAppearance | null, };

// Source: v2/ThreadSectionAppearance.ts
/**
 * Extensible visual presentation for a custom thread section.
 */
export type ThreadSectionAppearance = { icon: string | null, color: string | null, };

// Source: v2/ThreadResumeParams.ts
/**
 * Resume a persisted or currently loaded thread by id.
 */
export type ThreadResumeParams = {threadId: string, /**
 * Configuration overrides for the resumed thread, if any.
 */
model?: string | null, modelProvider?: string | null, serviceTier?: string | null | null, cwd?: string | null, approvalPolicy?: AskForApproval | null, /**
 * Override where approval requests are routed for review on this thread
 * and subsequent turns.
 */
approvalsReviewer?: ApprovalsReviewer | null, sandbox?: SandboxMode | null, config?: { [key in string]?: JsonValue } | null, baseInstructions?: string | null, developerInstructions?: string | null, personality?: Personality | null};

// Source: v2/ThreadResumeResponse.ts
export type ThreadResumeResponse = {thread: Thread, model: string, modelProvider: string, serviceTier: string | null, cwd: AbsolutePathBuf, /**
 * Environment-native paths to instruction source files currently loaded for this thread.
 */
instructionSources: Array<LegacyAppPathString>, approvalPolicy: AskForApproval, /**
 * Reviewer currently used for approval requests on this thread.
 */
approvalsReviewer: ApprovalsReviewer, /**
 * Legacy sandbox policy retained for compatibility. Experimental clients
 * should prefer `activePermissionProfile` for profile provenance.
 */
sandbox: SandboxPolicy, reasoningEffort: ReasoningEffort | null};

// Source: v2/ThreadSource.ts
export type ThreadSource = string;

// Source: v2/ThreadStartParams.ts
export type ThreadStartParams = {model?: string | null, modelProvider?: string | null, serviceTier?: string | null | null, cwd?: string | null, approvalPolicy?: AskForApproval | null, /**
 * Override where approval requests are routed for review on this thread
 * and subsequent turns.
 */
approvalsReviewer?: ApprovalsReviewer | null, sandbox?: SandboxMode | null, config?: { [key in string]?: JsonValue } | null, serviceName?: string | null, baseInstructions?: string | null, developerInstructions?: string | null, personality?: Personality | null, ephemeral?: boolean | null, sessionStartSource?: ThreadStartSource | null, /**
 * Optional client-supplied analytics source classification for this thread.
 */
threadSource?: ThreadSource | null};

// Source: v2/ThreadStartResponse.ts
export type ThreadStartResponse = {thread: Thread, model: string, modelProvider: string, serviceTier: string | null, cwd: AbsolutePathBuf, /**
 * Environment-native paths to instruction source files currently loaded for this thread.
 */
instructionSources: Array<LegacyAppPathString>, approvalPolicy: AskForApproval, /**
 * Reviewer currently used for approval requests on this thread.
 */
approvalsReviewer: ApprovalsReviewer, /**
 * Legacy sandbox policy retained for compatibility. Experimental clients
 * should prefer `activePermissionProfile` for profile provenance.
 */
sandbox: SandboxPolicy, reasoningEffort: ReasoningEffort | null};

// Source: v2/ThreadStartSource.ts
export type ThreadStartSource = "startup" | "clear";

// Source: v2/ThreadStatus.ts
export type ThreadStatus = { "type": "notLoaded" } | { "type": "idle" } | { "type": "systemError" } | { "type": "active", activeFlags: Array<ThreadActiveFlag>, };

// Source: v2/ThreadTokenUsage.ts
export type ThreadTokenUsage = { total: TokenUsageBreakdown, last: TokenUsageBreakdown, modelContextWindow: number | null, };

// Source: v2/ThreadTokenUsageUpdatedNotification.ts
export type ThreadTokenUsageUpdatedNotification = { threadId: string, turnId: string, tokenUsage: ThreadTokenUsage, };

// Source: v2/TokenUsageBreakdown.ts
export type TokenUsageBreakdown = { totalTokens: number, inputTokens: number, cachedInputTokens: number, cacheWriteInputTokens: number, outputTokens: number, reasoningOutputTokens: number, };

// Source: v2/Turn.ts
export type Turn = {
/**
 * Identifier for this turn. Codex-generated turn IDs are UUIDv7.
 */
id: string,
/**
 * Thread items currently included in this turn payload.
 */
items: Array<ThreadItem>,
/**
 * Describes how much of `items` has been loaded for this turn.
 */
itemsView: TurnItemsView, status: TurnStatus,
/**
 * Only populated when the Turn's status is failed.
 */
error: TurnError | null,
/**
 * Unix timestamp (in seconds) when the turn started.
 */
startedAt: number | null,
/**
 * Unix timestamp (in seconds) when the turn completed.
 */
completedAt: number | null,
/**
 * Duration between turn start and completion in milliseconds, if known.
 */
durationMs: number | null, };

// Source: v2/TurnCompletedNotification.ts
export type TurnCompletedNotification = { threadId: string, turn: Turn, };

// Source: v2/TurnError.ts
export type TurnError = { message: string, codexErrorInfo: CodexErrorInfo | null, additionalDetails: string | null, };

// Source: v2/TurnInterruptParams.ts
export type TurnInterruptParams = { threadId: string, turnId: string, };

// Source: v2/TurnInterruptResponse.ts
export type TurnInterruptResponse = Record<string, never>;

// Source: v2/TurnItemsView.ts
export type TurnItemsView = "notLoaded" | "summary" | "full";

// Source: v2/TurnPlanStep.ts
export type TurnPlanStep = { step: string, status: TurnPlanStepStatus, };

// Source: v2/TurnPlanStepStatus.ts
export type TurnPlanStepStatus = "pending" | "inProgress" | "completed";

// Source: v2/TurnPlanUpdatedNotification.ts
export type TurnPlanUpdatedNotification = { threadId: string, turnId: string, explanation: string | null, plan: Array<TurnPlanStep>, };

// Source: v2/TurnStartParams.ts
export type TurnStartParams = {threadId: string, clientUserMessageId?: string | null, input: Array<UserInput>, /**
 * Override the working directory for this turn and subsequent turns.
 */
cwd?: string | null, /**
 * Override the approval policy for this turn and subsequent turns.
 */
approvalPolicy?: AskForApproval | null, /**
 * Override where approval requests are routed for review on this turn and
 * subsequent turns.
 */
approvalsReviewer?: ApprovalsReviewer | null, /**
 * Override the sandbox policy for this turn and subsequent turns.
 */
sandboxPolicy?: SandboxPolicy | null, /**
 * Override the model for this turn and subsequent turns.
 */
model?: string | null, /**
 * Override the service tier for this turn and subsequent turns.
 */
serviceTier?: string | null | null, /**
 * Override the reasoning effort for this turn and subsequent turns.
 */
effort?: ReasoningEffort | null, /**
 * Override the reasoning summary for this turn and subsequent turns.
 */
summary?: ReasoningSummary | null, /**
 * Override the personality for this turn and subsequent turns.
 */
personality?: Personality | null, /**
 * Optional JSON Schema used to constrain the final assistant message for
 * this turn.
 */
outputSchema?: JsonValue | null};

// Source: v2/TurnStartResponse.ts
export type TurnStartResponse = { turn: Turn, };

// Source: v2/TurnStartedNotification.ts
export type TurnStartedNotification = { threadId: string, turn: Turn, };

// Source: v2/TurnStatus.ts
export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

// Source: v2/UserInput.ts
export type UserInput = { "type": "text", text: string,
/**
 * UI-defined spans within `text` used to render or persist special elements.
 */
text_elements: Array<TextElement>, } | { "type": "image", detail?: ImageDetail, url: string, } | { "type": "localImage", detail?: ImageDetail, path: string, } | { "type": "audio", url: string, } | { "type": "localAudio", path: string, } | { "type": "skill", name: string, path: string, } | { "type": "mention", name: string, path: string, };

// Source: v2/WebSearchAction.ts
export type WebSearchAction = { "type": "search", query: string | null, queries: Array<string> | null, } | { "type": "openPage", url: string | null, } | { "type": "findInPage", url: string | null, pattern: string | null, } | { "type": "other" };

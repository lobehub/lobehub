/**
 * Claude Code Adapter
 *
 * Converts Claude Code CLI `--output-format stream-json --verbose` (ndjson)
 * events into unified HeterogeneousAgentEvent[] that the executor feeds into
 * LobeHub's Gateway event handler.
 *
 * Stream-json event shapes (from real CLI output):
 *
 *   {type: 'system', subtype: 'init', session_id, model, ...}
 *   {type: 'assistant', message: {id, content: [{type: 'thinking', thinking}], ...}}
 *   {type: 'assistant', message: {id, content: [{type: 'tool_use', id, name, input}], ...}}
 *   {type: 'user', message: {content: [{type: 'tool_result', tool_use_id, content}]}}
 *   {type: 'assistant', message: {id: <NEW>, content: [{type: 'text', text}], ...}}
 *   {type: 'result', is_error, result, ...}
 *   {type: 'rate_limit_event', ...}
 *
 * When the spawn site passes `--include-partial-messages` (desktop driver
 * does, CLI / sandbox runs do not), CC also emits token-level deltas wrapped
 * as:
 *
 *   {type: 'stream_event', event: {type: 'message_start', message: {id, model, ...}}}
 *   {type: 'stream_event', event: {type: 'content_block_delta', index, delta: {type: 'text_delta', text}}}
 *   {type: 'stream_event', event: {type: 'content_block_delta', index, delta: {type: 'thinking_delta', thinking}}}
 *
 * Deltas arrive BEFORE the matching `assistant` event that carries the full
 * content block. We stream the deltas out as incremental chunks and suppress
 * the duplicate emission from `handleAssistant` for any message.id that has
 * already been streamed.
 *
 * Key characteristics:
 * - Each content block (thinking / tool_use / text) streams in its OWN assistant event
 * - Multiple events can share the same `message.id` — these are ONE LLM turn
 * - When `message.id` changes, a new LLM turn has begun — new DB assistant message
 * - `tool_result` blocks are in `type: 'user'` events, not assistant events
 */

import type {
  AgentEventAdapter,
  ExternalSignalContext,
  HeterogeneousAgentEvent,
  HeterogeneousRateLimitInfo,
  HeterogeneousTerminalErrorData,
  StreamChunkData,
  SubagentEventContext,
  SubagentSpawnMetadata,
  ToolCallPayload,
  ToolResultData,
  UsageData,
} from '../types';

/**
 * The CC tool_use `name` we synthesize `pluginState.todos` for. Inlined here
 * (rather than imported from `@lobechat/builtin-tool-claude-code`) to keep
 * the adapter package free of UI-tool-package coupling — the canonical
 * `ClaudeCodeApiName` enum still lives in `@lobechat/builtin-tool-claude-code`
 * for renderer / inspector / streaming consumers, but those packages are
 * downstream of the adapter, not upstream.
 *
 * The string is upstream wire data emitted by `claude` itself, so a change
 * would require both sides (adapter + downstream renderers) to update
 * regardless of whether they share a constant.
 */
const CC_TODO_WRITE_TOOL_NAME = 'TodoWrite';

/**
 * CC 2.1.143+ replaced the declarative {@link CC_TODO_WRITE_TOOL_NAME} with
 * an imperative trio: one task per `TaskCreate` (server-assigned numeric id),
 * field-merge mutations via `TaskUpdate`, and `TaskList` as the only
 * full-state read. The adapter accumulates these into a per-session map and
 * synthesizes the shared `pluginState.todos` shape on each task-tool
 * tool_result so the existing TodoProgress UI keeps working.
 *
 * The old TodoWrite path stays alongside — resumed sessions started on an
 * older CC may still emit it, and CC's recent SDK reminder text doesn't
 * forbid the model from using TodoWrite if it really wants to.
 */
const CC_TASK_CREATE_TOOL_NAME = 'TaskCreate';
const CC_TASK_UPDATE_TOOL_NAME = 'TaskUpdate';
const CC_TASK_LIST_TOOL_NAME = 'TaskList';

/**
 * tool_result confirmation emitted by CC for a successful `TaskCreate`.
 * Observed shape on CC 2.1.143: `Task #1 created successfully: <subject>`.
 * The numeric id is the only place we can read the CC-assigned handle —
 * `TaskCreate.input` itself does not echo it.
 */
const TASK_CREATE_RESULT_PATTERN = /^Task #(\d+) created successfully/;

/**
 * tool_result confirmation emitted by CC for a successful `TaskUpdate`.
 * Suffix varies (`status`, blank if no field changed, etc.); we only need
 * the id to confirm the mutation landed — the field deltas are already
 * carried by the cached `TaskUpdate.input`.
 */
const TASK_UPDATE_RESULT_PATTERN = /^Updated task #\d+/;

/**
 * One line of `TaskList`'s plain-text output: `#1 [in_progress] read hosts`.
 * Used as the resume reconciliation path — when this adapter joins a CC
 * session mid-stream and missed earlier Create / Update events, parsing
 * TaskList rebuilds id / subject / status. `activeForm` and `description`
 * cannot be recovered (CC omits them) so resumed in_progress tasks fall
 * back to the subject text, same as TodoWrite's content-fallback.
 */
const TASK_LIST_LINE_PATTERN = /^#(\d+) \[(pending|in_progress|completed)\] (.+)$/;

/**
 * Tool name CC sees for the LobeHub-hosted MCP `ask_user_question` server.
 * Source of truth lives in `../askUser/constants.ts`; replicated here as a
 * literal so the adapter compiles in browser bundles without dragging in
 * any of the askUser package's runtime (node:http, MCP SDK, etc.) by
 * accident. Keep in sync.
 */
const ASK_USER_MCP_TOOL_NAME = 'mcp__lobe_cc__ask_user_question';

/**
 * apiName the adapter rewrites the MCP tool to so the renderer routes on
 * a stable key, not the wire-prefixed MCP name. Source of truth same as
 * above.
 */
const ASK_USER_API_NAME = 'askUserQuestion';

/** Status of a single todo item in CC's `TodoWrite` tool_use. */
type ClaudeCodeTodoStatus = 'pending' | 'in_progress' | 'completed';

interface ClaudeCodeTodoItem {
  /** Present-continuous form, shown while the item is in progress. */
  activeForm: string;
  /** Imperative description, shown in pending & completed states. */
  content: string;
  status: ClaudeCodeTodoStatus;
}

interface TodoWriteArgs {
  todos: ClaudeCodeTodoItem[];
}

/**
 * Shared synthesized status alphabet (`pending|in_progress|completed` →
 * `todo|processing|completed`) used by both the TodoWrite and the Task*
 * pluginState paths. Aliased here so the two synthesizers stay aligned.
 */
type SynthesizedTodoStatus = 'todo' | 'processing' | 'completed';

/** Cached `TaskCreate.input`, keyed by `tool_use.id` until the matching tool_result arrives. */
interface CachedTaskCreateInput {
  activeForm?: string;
  description?: string;
  subject: string;
}

/** Cached `TaskUpdate.input`, keyed by `tool_use.id` until the matching tool_result arrives. */
interface CachedTaskUpdateInput {
  activeForm?: string;
  description?: string;
  status?: ClaudeCodeTodoStatus | 'deleted';
  subject?: string;
  taskId: string;
}

/**
 * Per-session accumulator entry — the adapter's running mirror of CC's
 * task list, keyed by the CC-assigned numeric id. Updated as Create /
 * Update tool_results land, and (when present) reconciled against
 * `TaskList` tool_results to recover from resume gaps.
 */
interface ClaudeCodeTaskEntry {
  /** Empty until a TaskCreate or TaskUpdate populated it; TaskList output cannot recover this. */
  activeForm?: string;
  description?: string;
  status: ClaudeCodeTodoStatus;
  subject: string;
}

const CLAUDE_CODE_CLI_INSTALL_DOCS_URL = 'https://docs.anthropic.com/en/docs/claude-code/setup';

const CLI_AUTH_REQUIRED_PATTERNS = [
  /failed to authenticate/i,
  /invalid authentication credentials/i,
  /authentication[_ ]error/i,
  /not authenticated/i,
  /\bunauthorized\b/i,
  /\b401\b/,
] as const;

/**
 * Genuinely user-side limit wording. Used only as the text fallback for
 * batch CLI / sandbox runs that don't emit a structured `rate_limit_event`
 * (so {@link isUserQuotaRateLimit} can't fire). The ambiguous bare
 * `rate limit` / `rate limited` substring is deliberately NOT here — it also
 * appears in Anthropic's transient server throttle, so leaning on it would
 * reintroduce the very misclassification this set exists to avoid.
 */
const CLI_USER_RATE_LIMIT_PATTERNS = [
  /you'?ve hit your limit/i,
  /usage limit reached/i,
  /\blimit reached\b/i,
] as const;

/**
 * Anthropic's server-side transient throttle. CC surfaces this as a 429 with
 * a message that explicitly disclaims the user's plan limit ("not your usage
 * limit") — e.g. `API Error: Server is temporarily limiting requests (not your
 * usage limit) · Rate limited`. It clears on its own in moments, so it must be
 * classified as `overloaded` (retry UX), NOT `rate_limit` (which renders a
 * misleading "usage limit reached" reset-time guide).
 */
const CLI_SERVER_THROTTLE_PATTERNS = [
  /not your usage limit/i,
  /server is temporarily limiting requests/i,
] as const;

const CLI_OVERLOADED_PATTERNS = [
  /overloaded_error/i,
  /\boverloaded\b/i,
  /api error:\s*529\b/i,
  ...CLI_SERVER_THROTTLE_PATTERNS,
] as const;

/**
 * Discriminates a user-side plan/quota limit from everything else.
 *
 * Two signals must BOTH hold:
 *  1. The request was actually `status: 'rejected'`. Anthropic stamps a
 *     `rate_limit_info` onto its events even when the request goes through
 *     (`status: 'allowed'`) — that block is just the rolling-window metadata
 *     (`resetsAt`, `rateLimitType`) for an *allowed* call, NOT evidence the
 *     limit was hit. Leaning on the presence of a reset window alone made a
 *     later unrelated terminal failure (e.g. an `ECONNRESET` network drop)
 *     inherit the last allowed event's window and render a bogus "usage limit
 *     reached, resets at X" guide. The `status` is the gate.
 *  2. A concrete reset window (`resetsAt` epoch seconds and/or a named
 *     `rateLimitType` such as `seven_day`). A bare `rejected` with no window is
 *     Anthropic's transient server throttle — left to the overloaded (retry)
 *     classifier, not the usage-limit guide.
 *
 * Status codes (429 / 529) and message text are deliberately not consulted
 * here — only this structured signal decides the "usage limit reached" guide.
 */
const isUserQuotaRateLimit = (info?: HeterogeneousRateLimitInfo): boolean =>
  !!info && info.status === 'rejected' && (info.resetsAt != null || info.rateLimitType != null);

const getCliResultMessage = (result: unknown): string | undefined => {
  if (typeof result === 'string') return result;
  if (
    result &&
    typeof result === 'object' &&
    'message' in result &&
    typeof result.message === 'string'
  ) {
    return result.message;
  }

  try {
    return result == null ? undefined : JSON.stringify(result);
  } catch {
    return undefined;
  }
};

const getAuthRequiredTerminalError = (
  result: unknown,
): HeterogeneousTerminalErrorData | undefined => {
  const rawMessage = getCliResultMessage(result);
  if (!rawMessage || !CLI_AUTH_REQUIRED_PATTERNS.some((pattern) => pattern.test(rawMessage))) {
    return;
  }

  return {
    agentType: 'claude-code',
    clearEchoedContent: true,
    code: 'auth_required',
    docsUrl: CLAUDE_CODE_CLI_INSTALL_DOCS_URL,
    error: rawMessage,
    message:
      'Claude Code could not authenticate. Sign in again or refresh its credentials, then retry.',
    stderr: rawMessage,
  };
};

const toRateLimitInfo = (value: unknown): HeterogeneousRateLimitInfo | undefined => {
  if (!value || typeof value !== 'object') return;

  const raw = value as Record<string, unknown>;

  return {
    isUsingOverage: typeof raw.isUsingOverage === 'boolean' ? raw.isUsingOverage : undefined,
    overageDisabledReason:
      typeof raw.overageDisabledReason === 'string' ? raw.overageDisabledReason : undefined,
    overageStatus: typeof raw.overageStatus === 'string' ? raw.overageStatus : undefined,
    rateLimitType: typeof raw.rateLimitType === 'string' ? raw.rateLimitType : undefined,
    resetsAt: typeof raw.resetsAt === 'number' ? raw.resetsAt : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
  };
};

const getOverloadedTerminalError = (
  result: unknown,
  apiErrorStatus?: unknown,
  rateLimitInfo?: HeterogeneousRateLimitInfo,
): HeterogeneousTerminalErrorData | undefined => {
  const rawMessage = getCliResultMessage(result);
  // A real user-quota limit is the rate-limit classifier's job — never steal
  // it here, even if it happened to ride in on a 429/529.
  if (isUserQuotaRateLimit(rateLimitInfo)) return;

  const looksOverloaded =
    // Both 529 (upstream overloaded) and a 429 with no quota signal (transient
    // server throttle) are momentary server-side conditions — same retry UX.
    apiErrorStatus === 529 ||
    apiErrorStatus === 429 ||
    (!!rawMessage && CLI_OVERLOADED_PATTERNS.some((pattern) => pattern.test(rawMessage)));

  if (!looksOverloaded || !rawMessage) return;

  return {
    agentType: 'claude-code',
    clearEchoedContent: true,
    code: 'overloaded',
    error: rawMessage,
    message: rawMessage,
    stderr: rawMessage,
  };
};

const getRateLimitTerminalError = (
  result: unknown,
  rateLimitInfo?: HeterogeneousRateLimitInfo,
): HeterogeneousTerminalErrorData | undefined => {
  const rawMessage = getCliResultMessage(result);

  // Primary signal: the structured rate_limit_event carries a concrete reset
  // window → this is the user's plan/quota limit. Fallback (batch runs with no
  // rate_limit_event): clearly user-side wording that doesn't disclaim the
  // limit. Everything else — bare 429, "rate limited", server throttle — is
  // left to the overloaded classifier so it gets the retry UX, not a
  // misleading "usage limit reached, resets at X" guide.
  const looksLikeServerThrottle =
    !!rawMessage && CLI_SERVER_THROTTLE_PATTERNS.some((pattern) => pattern.test(rawMessage));
  const looksLikeUserLimit =
    isUserQuotaRateLimit(rateLimitInfo) ||
    (!!rawMessage &&
      !looksLikeServerThrottle &&
      CLI_USER_RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(rawMessage)));

  if (!looksLikeUserLimit || !rawMessage) return;

  return {
    agentType: 'claude-code',
    clearEchoedContent: true,
    code: 'rate_limit',
    error: rawMessage,
    message: rawMessage,
    rateLimitInfo,
    stderr: rawMessage,
  };
};

/**
 * CC's TodoWrite is a declarative state-write tool: its `tool_use.input` IS
 * the target todos list, and the `tool_result` content is just a confirmation
 * string. Translating the input into the shared `StepContextTodos` shape lets
 * the Gateway/ACP-aligned `pluginState.todos` contract light up the
 * TodoProgress card without any CC-specific knowledge leaking into selectors
 * or executors.
 *
 * Word mapping: CC `pending|in_progress|completed` → shared `todo|processing|completed`.
 * Text field: use `activeForm` while in progress (present-continuous is what
 * the header surfaces), fall back to `content` for every other state.
 */
/**
 * Synthesized `pluginState.todos` shape consumed by `selectTodosFromMessages`.
 *
 * `id` is optional: legacy `TodoWrite` snapshots are positional and have no
 * stable id, while the CC 2.1.143+ Task* tools carry the CC-server-assigned
 * numeric id so per-call inspectors can resolve `args.taskId` → subject text
 * without falling back to a cryptic `#N` label.
 */
interface SynthesizedTodoPluginState {
  todos: {
    items: Array<{ id?: string; status: SynthesizedTodoStatus; text: string }>;
    updatedAt: string;
  };
}

const toSynthesizedStatus = (status: ClaudeCodeTodoStatus): SynthesizedTodoStatus =>
  status === 'in_progress' ? 'processing' : status === 'pending' ? 'todo' : 'completed';

const synthesizeTodoWritePluginState = (args: TodoWriteArgs): SynthesizedTodoPluginState => {
  const items = (args.todos || []).map((todo: ClaudeCodeTodoItem) => {
    const text = todo.status === 'in_progress' ? todo.activeForm || todo.content : todo.content;
    return { status: toSynthesizedStatus(todo.status), text } as const;
  });
  return { todos: { items, updatedAt: new Date().toISOString() } };
};

/**
 * Snapshot the running `claudeCodeTasks` accumulator into the shared
 * `pluginState.todos` shape. Sorted by numeric id so the rendered order
 * matches CC's own TaskList output (insertion order = id order in practice,
 * but TaskUpdate can rearrange status without rearranging ids). Carries the
 * `id` per item so the TaskUpdate inspector can resolve `args.taskId` →
 * subject text without falling back to a `#N` label.
 *
 * Text resolution mirrors {@link synthesizeTodoWritePluginState}: use
 * `activeForm` while in progress so the spinner reads "Running tests"
 * rather than "Run tests"; fall back to `subject` whenever activeForm is
 * missing (TaskList-reconciled entries, or a TaskCreate that omitted it).
 */
const synthesizeTaskPluginState = (
  tasks: Map<string, ClaudeCodeTaskEntry>,
): SynthesizedTodoPluginState => {
  const items = [...tasks.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, entry]) => {
      const text =
        entry.status === 'in_progress' ? entry.activeForm || entry.subject : entry.subject;
      return { id, status: toSynthesizedStatus(entry.status), text } as const;
    });
  return { todos: { items, updatedAt: new Date().toISOString() } };
};

/**
 * Convert a raw Anthropic-shape usage object (per-turn or grand-total from
 * Claude Code's `result` event) into the provider-agnostic `UsageData` shape.
 * Returns undefined when no tokens were consumed, so callers can skip empty
 * events without a null-check cascade.
 */
const toUsageData = (
  raw:
    | {
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
      }
    | null
    | undefined,
): UsageData | undefined => {
  if (!raw) return undefined;
  const inputCacheMissTokens = raw.input_tokens || 0;
  const inputCachedTokens = raw.cache_read_input_tokens || 0;
  const inputWriteCacheTokens = raw.cache_creation_input_tokens || 0;
  const totalInputTokens = inputCacheMissTokens + inputCachedTokens + inputWriteCacheTokens;
  const totalOutputTokens = raw.output_tokens || 0;
  if (totalInputTokens + totalOutputTokens === 0) return undefined;
  return {
    inputCacheMissTokens,
    inputCachedTokens: inputCachedTokens || undefined,
    inputWriteCacheTokens: inputWriteCacheTokens || undefined,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
};

// ─── Adapter ───

export class ClaudeCodeAdapter implements AgentEventAdapter {
  sessionId?: string;
  private pendingRateLimitInfo?: HeterogeneousRateLimitInfo;

  /** Pending tool_use ids awaiting their tool_result */
  private pendingToolCalls = new Set<string>();
  private started = false;
  private stepIndex = 0;
  /**
   * True once any `stream_event` wrapper is seen — i.e. CC was spawned with
   * `--include-partial-messages` (desktop driver). The `lh hetero exec` CLI
   * used by device + sandbox runs spawns in BATCH mode (no partial flag), so
   * this stays false and `handleAssistant` owns per-turn usage instead of
   * `message_delta`.
   */
  private sawStreamEvent = false;
  /** Track current message.id to detect step boundaries */
  private currentMessageId: string | undefined;
  /**
   * Whether the current turn (the in-flight `currentMessageId`) has already
   * emitted a `tool_use`. When CC reuses the SAME `message.id` to stream the
   * model's post-tool answer (it continues after the `tool_result` without
   * minting a fresh id — seen on device/batch `lh hetero exec` runs), that
   * trailing text must NOT coalesce onto the tool-issuing assistant. We force a
   * step boundary so the answer anchors to its own assistant, chained after the
   * tool results — otherwise text + `tool_use` share one message and the
   * renderer drops the tool block below the answer.
   */
  private currentTurnHadToolUse = false;
  /** message.id of the stream_event delta flow currently in flight */
  private currentStreamEventMessageId: string | undefined;
  /**
   * Latest model seen for the in-flight message.id — captured from
   * `message_start` (partial mode) or `assistant` events, emitted alongside
   * authoritative usage on `message_delta`.
   */
  private currentStreamEventModel: string | undefined;
  /** Cumulative text streamed via partial-message deltas, keyed by message.id. */
  private streamedTextByMessageId = new Map<string, string>();
  /** Cumulative thinking streamed via partial-message deltas, keyed by message.id. */
  private streamedThinkingByMessageId = new Map<string, string>();
  /**
   * Cumulative tool_use blocks per message.id. CC streams each tool_use in
   * its OWN assistant event, and the handler's in-memory assistant.tools
   * update uses a REPLACING array merge — so chunks must carry every tool
   * seen on this turn, not just the latest, or prior tools render as orphans
   * until the next `fetchAndReplaceMessages`.
   */
  private toolCallsByMessageId = new Map<string, ToolCallPayload[]>();
  /**
   * Cached TodoWrite inputs keyed by tool_use.id. Populated in `handleAssistant`
   * when a TodoWrite tool_use block arrives and drained in `handleUser` at
   * tool_result time so the synthesized pluginState can travel with the result
   * event. Entries are deleted immediately after emit to keep long sessions
   * bounded.
   */
  private todoWriteInputs = new Map<string, TodoWriteArgs>();
  /**
   * Cached `TaskCreate.input` keyed by `tool_use.id`. Drained in `handleUser`
   * once the matching tool_result lands: at that point we parse the
   * CC-assigned numeric id from `Task #N created successfully` and push the
   * cached fields into {@link claudeCodeTasks}. Cleared even on error to
   * keep long sessions bounded — failed creates never reach the accumulator.
   */
  private taskCreateInputs = new Map<string, CachedTaskCreateInput>();
  /**
   * Cached `TaskUpdate.input` keyed by `tool_use.id`. Drained on
   * tool_result; on success the cached fields merge into the targeted entry
   * in {@link claudeCodeTasks}. `status: 'deleted'` removes the entry.
   */
  private taskUpdateInputs = new Map<string, CachedTaskUpdateInput>();
  /**
   * Tool_use ids of `TaskList` calls awaiting their tool_result. Used to
   * dispatch the reconciliation parser without re-checking the tool name on
   * every user event. `TaskList.input` is empty so no payload to cache.
   */
  private pendingTaskListCalls = new Set<string>();
  /**
   * Adapter's running mirror of CC's task list, keyed by the CC-assigned
   * numeric task id. Survives across `result` events because CC keeps the
   * task list alive between turns within one session; cleared only when
   * the adapter is destroyed. This is what `synthesizeTaskPluginState`
   * snapshots on each task-tool tool_result.
   */
  private claudeCodeTasks = new Map<string, ClaudeCodeTaskEntry>();
  /**
   * Cached inputs for main-agent tool_uses keyed by their tool_use.id.
   * Populated for every main-agent tool_use (not just `Task`) because
   * CC uses multiple tool names for subagent delegation — real traces
   * emit `Agent` for general-purpose subagents while the spec documents
   * `Task`. Keying on "any main-agent tool" and looking up by
   * `parent_tool_use_id` on the FIRST subagent event lets us extract
   * `description` / `prompt` / `subagent_type` regardless of which
   * spawn-tool variant the model used. Kept adapter-internal — the
   * executor never reads this map; it only sees the normalized
   * `SubagentSpawnMetadata`.
   */
  private mainToolInputsById = new Map<string, Record<string, any>>();
  /**
   * Set of parent tool_use ids whose spawn metadata has already been
   * announced on a subagent event. Guarantees `spawnMetadata` appears
   * exactly once per subagent run — on the first subagent event for that
   * parent — so the executor's lazy-create logic isn't tempted to
   * recreate the Thread on every chunk.
   */
  private announcedSpawns = new Set<string>();

  /**
   * Build the spawn metadata (`description` / `prompt` / `subagent_type`) for a
   * subagent's parent tool_use from the cached Task/Agent input. Pure: it neither
   * reads nor mutates {@link announcedSpawns} — the caller gates "exactly once"
   * and only marks the parent announced when the metadata is actually attached to
   * an EMITTED chunk (see `handleSubagentAssistant`). Returns undefined when the
   * parent's args were never cached.
   */
  private buildSpawnMetadata(parentToolCallId: string): SubagentSpawnMetadata | undefined {
    const args = this.mainToolInputsById.get(parentToolCallId);
    if (!args) return undefined;
    // CC's subagent-spawn tools (Task, Agent, ...) share the same input shape
    // (`description`, `prompt`, `subagent_type`). Pull the fields defensively —
    // any unknown spawn-tool variant matching this shape benefits automatically.
    return {
      description: typeof args.description === 'string' ? args.description : undefined,
      prompt: typeof args.prompt === 'string' ? args.prompt : undefined,
      subagentType: typeof args.subagent_type === 'string' ? args.subagent_type : undefined,
    };
  }
  /**
   * Tool name keyed by main-agent `tool_use.id`. Used to label the
   * resulting {@link ExternalSignalContext} when a Monitor-style task
   * fires a callback turn.
   *
   * Populated for every main-agent tool_use; subagent inner tools are
   * excluded because their tool_results route through `subagent.parentToolCallId`,
   * not the main-agent signal detector.
   */
  private mainToolNamesById = new Map<string, string>();
  /**
   * Active CC tasks (long-running tools registered via `system task_started`).
   * Keyed by `task_id`, carries the originating `tool_use_id`, the resolved
   * tool name, and a counter incremented for each signal callback turn
   * the adapter attributes to this task.
   *
   * A task lives from `task_started` until `task_notification` /
   * `task_completed`. While alive, any `message_start` that opens a turn
   * WITHOUT a preceding `user` event is a signal callback and gets tagged.
   */
  private activeTasks = new Map<
    string,
    { callbackCount: number; sourceToolName: string; toolUseId: string }
  >();
  /**
   * True after a `user` event has been seen but the next turn hasn't yet
   * opened (`message_start` not yet fired). Carries the "this next turn
   * is a natural follow-up to a tool_result, not a signal callback"
   * intent across the gap between the tool_result event and the
   * resulting assistant turn.
   *
   * Reset to `false` once a `message_start` consumes it. After that, any
   * further `message_start` that opens while {@link activeTasks} is
   * non-empty is treated as a signal callback (CC re-invoked the LLM
   * because a long-running tool pushed an update).
   */
  private hasUnhandledUserInput = false;
  /**
   * {@link ExternalSignalContext} to attach to the NEXT `stream_start(newStep)`.
   *
   * Armed by `message_start` when {@link hasUnhandledUserInput} is false
   * AND {@link activeTasks} is non-empty — i.e. CC opened a new turn
   * without fresh user input while a long-running tool is alive. Cleared
   * on the next `tool_use` (LLM is back on the main chain).
   */
  private pendingExternalSignal: ExternalSignalContext | undefined;
  /**
   * Source-tool lineage of the most recently completed long-running task,
   * waiting to be stamped on the post-task summary turn with
   * `type: 'task-completion'`.
   *
   * Armed when `system task_notification` ends an active task; consumed
   * by the NEXT `message_start` that takes the natural-turn branch
   * (no other active task triggering a callback). Cleared on `result`
   * so it never leaks across LLM runs.
   *
   * Lets the renderer keep the summary inside the same AssistantGroup as
   * the preceding callbacks instead of letting it spawn a separate group.
   */
  private pendingTaskCompletion: { sourceToolCallId: string; sourceToolName: string } | undefined;

  adapt(raw: any): HeterogeneousAgentEvent[] {
    if (!raw || typeof raw !== 'object') return [];

    switch (raw.type) {
      case 'rate_limit_event': {
        return this.handleRateLimitEvent(raw);
      }
      case 'system': {
        return this.handleSystem(raw);
      }
      case 'assistant': {
        return this.handleAssistant(raw);
      }
      case 'user': {
        return this.handleUser(raw);
      }
      case 'stream_event': {
        return this.handleStreamEvent(raw);
      }
      case 'result': {
        return this.handleResult(raw);
      }
      default: {
        return [];
      }
    }
  }

  flush(): HeterogeneousAgentEvent[] {
    // Close any still-open tools (shouldn't happen in normal flow, but be safe)
    const events = [...this.pendingToolCalls].map((id) =>
      this.makeEvent('tool_end', { isSuccess: true, toolCallId: id }),
    );
    this.pendingToolCalls.clear();
    return events;
  }

  // ─── Private handlers ───

  private handleSystem(raw: any): HeterogeneousAgentEvent[] {
    // CC's long-running task lifecycle (Monitor, etc., ).
    // `task_started` registers a task that may fire callback turns;
    // `task_notification` (terminal) drops it. While a task is alive,
    // any new turn without preceding user input is treated as a signal
    // callback in `openMainMessage`.
    if (raw.subtype === 'task_started' && raw.task_id && raw.tool_use_id) {
      const toolUseId: string = raw.tool_use_id;
      this.activeTasks.set(raw.task_id, {
        callbackCount: 0,
        sourceToolName: this.mainToolNamesById.get(toolUseId) ?? 'unknown',
        toolUseId,
      });
      return [];
    }
    if (raw.subtype === 'task_notification' && raw.task_id) {
      // Capture lineage BEFORE deleting so the next natural turn (the
      // post-task summary, after CC re-invokes the LLM with a synthesized
      // task-ended notification) can be tagged with `task-completion`.
      // Last-task-wins if multiple tasks end before a summary fires — in
      // practice CC summarizes once per LLM call.
      //
      // Gate on `callbackCount > 0`: only a task that actually fired out-of-band
      // callback turns while alive is a genuine long-running task whose ending
      // produces a post-task summary (the summary "keeps it inside the same
      // AssistantGroup as the preceding callbacks" — so there must BE preceding
      // callbacks). A task that fires `task_started` and `task_notification`
      // back-to-back with no intervening callback turn was an inline synchronous
      // tool that CC merely tracked as a task (e.g. a slow `git commit` running a
      // lint-staged hook); its `tool_result` is consumed by the next turn in the
      // normal main chain. Tagging that turn `task-completion` mis-anchors it and
      // drops it from the rendered chain — so leave it untagged.
      const ending = this.activeTasks.get(raw.task_id);
      if (ending && ending.callbackCount > 0) {
        this.pendingTaskCompletion = {
          sourceToolCallId: ending.toolUseId,
          sourceToolName: ending.sourceToolName,
        };
      }
      this.activeTasks.delete(raw.task_id);
      return [];
    }
    // `task_updated` is a status patch (status: 'completed' fires
    // alongside `task_notification`). Drop it — we drive lifecycle off
    // task_started / task_notification only.
    if (raw.subtype === 'task_updated') return [];

    if (raw.subtype !== 'init') return [];
    this.sessionId = raw.session_id;
    this.started = true;
    return [
      this.makeEvent('stream_start', {
        model: raw.model,
        provider: 'claude-code',
      }),
    ];
  }

  private handleAssistant(raw: any): HeterogeneousAgentEvent[] {
    // Claude Code emits a synthetic assistant text turn for rate-limit
    // failures. We already surface the structured rate-limit metadata via
    // the paired `rate_limit_event` + terminal `result`, so letting this
    // text through would momentarily render a duplicate plain-text bubble.
    if (raw.error === 'rate_limit') return [];

    const content = raw.message?.content;
    if (!Array.isArray(content)) return [];

    // CC tags subagent events (Agent / Task tool spawned flows) with
    // `parent_tool_use_id` pointing back at the outer tool_use. These are a
    // side-channel of the main agent's stream — they must not advance the
    // main step tracker, emit text into the main bubble, or double-count
    // usage. Route them through a dedicated handler so the main-agent flow
    // below stays free of subagent special cases.
    const parentToolUseId: string | undefined = raw.parent_tool_use_id;
    if (parentToolUseId) return this.handleSubagentAssistant(raw, parentToolUseId);

    const events: HeterogeneousAgentEvent[] = [];
    const messageId = raw.message?.id;

    // Detect a post-tool answer that REUSES the tool turn's message.id: a
    // text-only continuation (no tool_use of its own) on the in-flight id that
    // already emitted a tool_use. CC does this on device/batch runs where the
    // model keeps the same id after a tool_result; left unsplit, the answer text
    // lands on the tool-issuing assistant. An event carrying its OWN tool_use is
    // a normal preamble-then-tool turn and must stay on the same step.
    const hasTextBlock = content.some((b: any) => b?.type === 'text' && b.text);
    const hasToolUseBlock = content.some((b: any) => b?.type === 'tool_use');
    const isPostToolTextReusingId =
      hasTextBlock &&
      !hasToolUseBlock &&
      messageId !== undefined &&
      messageId === this.currentMessageId &&
      this.currentTurnHadToolUse;

    events.push(...this.openMainMessage(messageId, raw.message?.model, isPostToolTextReusingId));

    // Track the latest model — emitted alongside authoritative usage on the
    // matching `message_delta`. We deliberately do NOT emit turn_metadata
    // here: under `--include-partial-messages`, every content-block
    // `assistant` event echoes a STALE usage snapshot from `message_start`
    // (e.g. `output_tokens: 8`); the per-turn total only arrives on
    // `stream_event: message_delta`.
    if (raw.message?.model) this.currentStreamEventModel = raw.message.model;

    // Each content array here is usually ONE block (thinking OR tool_use OR text)
    // but we handle multiple defensively.
    const textParts: string[] = [];
    const reasoningParts: string[] = [];
    const newToolCalls: ToolCallPayload[] = [];

    for (const block of content) {
      switch (block.type) {
        case 'text': {
          if (block.text) textParts.push(block.text);
          break;
        }
        case 'thinking': {
          if (block.thinking) reasoningParts.push(block.thinking);
          break;
        }
        case 'tool_use': {
          // Rewrite our local MCP `ask_user_question` tool to a stable
          // apiName so the renderer routes on `askUserQuestion` (clean,
          // domain-named) instead of the wire-prefixed MCP form. Identifier
          // stays `claude-code` because this remains a CC-side tool.
          const apiName = block.name === ASK_USER_MCP_TOOL_NAME ? ASK_USER_API_NAME : block.name;
          newToolCalls.push({
            apiName,
            arguments: JSON.stringify(block.input || {}),
            id: block.id,
            identifier: 'claude-code',
            type: 'default',
          });
          this.pendingToolCalls.add(block.id);
          // Cache EVERY main-agent tool_use input so the subagent-spawn
          // handler (`emitToolChunk`) can look up the parent's args on
          // first subagent event regardless of which spawn-tool name CC
          // used (`Task`, `Agent`, etc.). Non-spawn tools occupy a tiny
          // amount of memory and get pruned naturally when the run ends.
          if (block.input) this.mainToolInputsById.set(block.id, block.input);
          // Cache the raw CC tool name (NOT the rewritten apiName) so a
          // later repeat tool_result on this id can label its
          // ExternalSignalContext with the actual tool — Monitor shows
          // up as `Monitor`, not the apiName remap.
          if (block.name) this.mainToolNamesById.set(block.id, block.name);
          if (block.name === CC_TODO_WRITE_TOOL_NAME && block.input) {
            this.todoWriteInputs.set(block.id, block.input as TodoWriteArgs);
          }
          // Task* tool inputs cached for the tool_result-time reducer.
          // Only TaskCreate / TaskUpdate carry payloads worth caching;
          // TaskList carries no input but we still need to remember the
          // tool_use.id so the result-side dispatcher can recognize it.
          if (block.name === CC_TASK_CREATE_TOOL_NAME && block.input) {
            this.taskCreateInputs.set(block.id, block.input as CachedTaskCreateInput);
          }
          if (block.name === CC_TASK_UPDATE_TOOL_NAME && block.input) {
            this.taskUpdateInputs.set(block.id, block.input as CachedTaskUpdateInput);
          }
          if (block.name === CC_TASK_LIST_TOOL_NAME) {
            this.pendingTaskListCalls.add(block.id);
          }
          break;
        }
      }
    }

    // Any main-agent tool_use means the LLM has acted again — the
    // reactive "signal-driven step" phase ends. Drop any pending signal
    // so future stream_starts go back on the main chain. The CURRENT
    // step's stream_start may have already shipped with the signal tag
    // (since it fires on `message_start`, before tool_use blocks
    // arrive); MessageCollector ignores `metadata.signal` on messages
    // with `tools.length > 0` so that mismatch is benign.
    if (newToolCalls.length > 0) {
      this.pendingExternalSignal = undefined;
      // Mark the in-flight turn so a later same-id text-only event is recognized
      // as a post-tool answer and split into its own step (see openMainMessage).
      this.currentTurnHadToolUse = true;
    }

    // Under `--include-partial-messages`, CC may emit deltas first and then a
    // final full assistant block for the SAME message.id. If the full block is
    // longer than the streamed deltas, emit only the missing suffix so the
    // persisted content does not lose the tail of the message.
    const textCompletion = this.getTrailingCompletion(
      messageId,
      textParts.join(''),
      this.streamedTextByMessageId,
    );
    const thinkingCompletion = this.getTrailingCompletion(
      messageId,
      reasoningParts.join(''),
      this.streamedThinkingByMessageId,
    );
    // Emit reasoning before text so the gateway event handler starts the
    // reasoning operation first — matching Claude's natural output order
    // (thinking → response). Without this, batch-mode runs (CLI / sandbox
    // without --include-partial-messages) emit text first, causing the
    // brain icon to appear below the already-rendered text content.
    if (thinkingCompletion) {
      events.push(this.makeChunkEvent({ chunkType: 'reasoning', reasoning: thinkingCompletion }));
    }
    if (textCompletion) {
      events.push(this.makeChunkEvent({ chunkType: 'text', content: textCompletion }));
    }
    if (messageId) {
      this.clearStreamedBuffers(messageId, {
        thinking: reasoningParts.length > 0,
        text: textParts.length > 0,
      });
    }
    events.push(...this.emitToolChunk(newToolCalls, messageId));

    // BATCH mode (no `--include-partial-messages`, e.g. the `lh hetero exec`
    // CLI used by device + sandbox runs): there is no `message_delta` to carry
    // per-turn usage, and the `assistant` event's usage is NOT a stale
    // message_start echo — it's the real per-message total. Emit it as
    // turn_metadata so usage (token counts) AND the canonical model id (the
    // `assistant` event reports a clean `claude-opus-4-8`, unlike `system init`
    // which appends a `[1m]` beta marker) land on the assistant message. In
    // partial mode (`sawStreamEvent`) `message_delta` owns this — skip here to
    // avoid double-counting the stale snapshot.
    if (!this.sawStreamEvent) {
      const usage = toUsageData(raw.message?.usage);
      if (usage) {
        events.push(
          this.makeEvent('step_complete', {
            model: raw.message?.model,
            phase: 'turn_metadata',
            provider: 'claude-code',
            usage,
          }),
        );
      }
    }

    return events;
  }

  private handleRateLimitEvent(raw: any): HeterogeneousAgentEvent[] {
    this.pendingRateLimitInfo = toRateLimitInfo(raw.rate_limit_info);
    return [];
  }

  /**
   * Handle a subagent assistant event (tagged with `parent_tool_use_id`).
   *
   * Subagent events are a side-channel of the main agent's stream and have
   * one hard constraint: no main-agent step boundary (each subagent turn
   * introduces a new `message.id`; flushing that as a newStep would orphan
   * main-agent bubbles).
   *
   * Text / reasoning from subagent events ARE emitted — as `stream_chunk`
   * events tagged with the `subagent` peer field — so the executor can
   * accumulate them into the in-thread assistant's content, giving the
   * Thread view a readable subagent conversation (user → assistant text
   * → tools → assistant text → ...). Without this the thread only ever
   * shows tool calls with no closing reasoning / summary.
   *
   * Usage on `raw.message.usage` is also emitted, as a
   * `step_complete{phase:turn_metadata, subagent}` event so the executor
   * can route the per-turn delta onto the subagent's in-thread assistant
   * (and bump the subagent run's running totalTokens for the inspector
   * chip). Note this is the FULL message.usage (subagent assistant events
   * are not partial-streamed, unlike main-agent assistant events which
   * carry stale `message_start` snapshots), so no de-stale logic is
   * needed here. The subagent ctx tag prevents the executor from writing
   * the same usage to the main agent's assistant — CC's `result` event
   * remains the grand total across main + subagents.
   *
   * Subagent lineage lives as event-level **peer fields** on each chunk
   * (`subagent.parentToolCallId` + `subagent.subagentMessageId`), not on
   * individual `ToolCallPayload` items — tool payloads stay minimal and
   * persistence-safe.
   */
  private handleSubagentAssistant(raw: any, parentToolUseId: string): HeterogeneousAgentEvent[] {
    const content = raw.message?.content;
    if (!Array.isArray(content)) return [];

    const messageId: string | undefined = raw.message?.id;
    const baseCtx: SubagentEventContext = {
      parentToolCallId: parentToolUseId,
      subagentMessageId: messageId ?? '',
    };

    // Build spawn metadata once per parent and hand it to the FIRST chunk this
    // event emits (reasoning, text, OR tool). The executor lazy-creates +
    // titles the Thread off whichever subagent event it sees first, so a
    // reasoning/text-first subagent must carry the metadata too — not just the
    // tool path — or the Thread is born with the generic "Subagent" title.
    //
    // `announcedSpawns` is marked only when the metadata is ACTUALLY attached to
    // an emitted chunk (inside `nextSubagentCtx`), not merely built here. A first
    // event that emits nothing the reducer consumes (empty text/thinking block,
    // an unsupported block, or a usage-only `content: []`) must NOT burn the
    // one-shot — otherwise the next real chunk would create the Thread with the
    // fallback title, the exact bug this guards against.
    let pendingSpawnMetadata = this.announcedSpawns.has(parentToolUseId)
      ? undefined
      : this.buildSpawnMetadata(parentToolUseId);
    const nextSubagentCtx = (): SubagentEventContext => {
      if (!pendingSpawnMetadata) return baseCtx;
      const ctx: SubagentEventContext = { ...baseCtx, spawnMetadata: pendingSpawnMetadata };
      pendingSpawnMetadata = undefined;
      this.announcedSpawns.add(parentToolUseId);
      return ctx;
    };

    const textParts: string[] = [];
    const reasoningParts: string[] = [];
    const newToolCalls: ToolCallPayload[] = [];
    for (const block of content) {
      switch (block.type) {
        case 'text': {
          if (block.text) textParts.push(block.text);
          break;
        }
        case 'thinking': {
          if (block.thinking) reasoningParts.push(block.thinking);
          break;
        }
        case 'tool_use': {
          // Rewrite our local MCP `ask_user_question` tool to a stable
          // apiName so the renderer routes on `askUserQuestion` (clean,
          // domain-named) instead of the wire-prefixed MCP form. Identifier
          // stays `claude-code` because this remains a CC-side tool.
          const apiName = block.name === ASK_USER_MCP_TOOL_NAME ? ASK_USER_API_NAME : block.name;
          newToolCalls.push({
            apiName,
            arguments: JSON.stringify(block.input || {}),
            id: block.id,
            identifier: 'claude-code',
            type: 'default',
          });
          this.pendingToolCalls.add(block.id);
          if (block.name === CC_TODO_WRITE_TOOL_NAME && block.input) {
            this.todoWriteInputs.set(block.id, block.input as TodoWriteArgs);
          }
          break;
        }
      }
    }

    const events: HeterogeneousAgentEvent[] = [];

    // Subagent text / reasoning chunks — NOT deduped against
    // `messagesWithStreamedText` (unlike the main-agent path) because
    // subagent events don't arrive via `stream_event` partial-messages
    // deltas; the full block IS the only emission.
    // Reasoning before text — same ordering fix as the main-agent batch path.
    if (reasoningParts.length > 0) {
      events.push(
        this.makeChunkEvent({
          chunkType: 'reasoning',
          reasoning: reasoningParts.join(''),
          subagent: nextSubagentCtx(),
        }),
      );
    }
    if (textParts.length > 0) {
      events.push(
        this.makeChunkEvent({
          chunkType: 'text',
          content: textParts.join(''),
          subagent: nextSubagentCtx(),
        }),
      );
    }
    // Only consume the pending spawn metadata for the tool chunk when this
    // event actually carries tools (else it would be lost on the no-op chunk).
    events.push(
      ...this.emitToolChunk(
        newToolCalls,
        messageId,
        newToolCalls.length > 0 ? nextSubagentCtx() : baseCtx,
      ),
    );

    const usage = toUsageData(raw.message?.usage);
    if (usage) {
      events.push(
        this.makeEvent('step_complete', {
          model: raw.message?.model,
          phase: 'turn_metadata',
          provider: 'claude-code',
          subagent: baseCtx,
          usage,
        }),
      );
    }

    return events;
  }

  /**
   * Accumulate new tool_use blocks for a message.id and emit the
   * `tools_calling` chunk + `tool_start` lifecycle events.
   *
   * CC streams each tool_use in its OWN assistant event and the downstream
   * handler's in-memory `assistant.tools` update uses a REPLACING array
   * merge — so the chunk must carry every tool seen on this turn, not just
   * the latest, or prior tools render as orphans until the next
   * `fetchAndReplaceMessages`. `tool_start` fires only for newly-seen ids
   * so an echoed tool_use does not re-open a closed lifecycle.
   *
   * When `subagentCtx` is provided, the chunk + each tool_start event
   * gets the context stamped as a peer field — including any `spawnMetadata`
   * the caller already attached (`handleSubagentAssistant` builds it once per
   * parent and hands it to the first emitted chunk, tool or otherwise).
   */
  private emitToolChunk(
    newToolCalls: ToolCallPayload[],
    messageId: string | undefined,
    subagentCtx?: SubagentEventContext,
  ): HeterogeneousAgentEvent[] {
    if (newToolCalls.length === 0) return [];

    const msgKey = messageId ?? '';
    const existing = this.toolCallsByMessageId.get(msgKey) ?? [];
    const existingIds = new Set(existing.map((t) => t.id));
    const freshTools = newToolCalls.filter((t) => !existingIds.has(t.id));
    const cumulative = [...existing, ...freshTools];
    this.toolCallsByMessageId.set(msgKey, cumulative);

    // The `subagent` peer field — stamped on the chunk + each tool_start —
    // is passed through verbatim (carrying `spawnMetadata` when the caller
    // designated this the first emission for the parent).
    const subagent: SubagentEventContext | undefined = subagentCtx;

    const chunkData: StreamChunkData = {
      chunkType: 'tools_calling',
      toolsCalling: cumulative,
    };
    if (subagent) chunkData.subagent = subagent;

    const events: HeterogeneousAgentEvent[] = [this.makeChunkEvent(chunkData)];
    for (const t of freshTools) {
      const startData: Record<string, any> = { toolCalling: t };
      if (subagent) startData.subagent = subagent;
      events.push(this.makeEvent('tool_start', startData));
    }
    return events;
  }

  /**
   * Handle user events — these contain tool_result blocks.
   * NOTE: In Claude Code, tool results are emitted as `type: 'user'` events
   * (representing the synthetic user turn that feeds results back to the LLM).
   *
   * When the user event carries `parent_tool_use_id`, the tool_result is
   * for a SUBAGENT inner tool. We stamp that as the `subagent` peer field
   * on both the `tool_result` and `tool_end` events so the executor routes
   * the update to the right Thread / tool message (subagent-turn-scoped,
   * not main-agent-scoped).
   */
  private handleUser(raw: any): HeterogeneousAgentEvent[] {
    const content = raw.message?.content;
    if (!Array.isArray(content)) return [];

    const subagentCtx: SubagentEventContext | undefined = raw.parent_tool_use_id
      ? { parentToolCallId: raw.parent_tool_use_id }
      : undefined;

    const events: HeterogeneousAgentEvent[] = [];

    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const toolCallId: string | undefined = block.tool_use_id;
      if (!toolCallId) continue;

      // Main-agent `user` events carrying tool_result mean the NEXT
      // assistant turn is a natural follow-up to that tool — not a
      // signal callback. Subagent inner tool_results don't count
      // (they have their own routing) and never block the main-agent
      // signal pipeline.
      if (!subagentCtx) {
        this.hasUnhandledUserInput = true;
      }

      const resultContent =
        typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content
                .map((c: any) => {
                  // `ToolSearch` results ship as `{type: 'tool_reference', tool_name}`
                  // blocks — no `text` / `content` field. Without this branch the
                  // mapper returns '' for every reference, filter drops them all,
                  // and the tool message lands in DB with empty content — leaving
                  // the UI's StatusIndicator stuck on the spinner ().
                  if (c?.type === 'tool_reference' && c.tool_name) return c.tool_name;
                  // `Read` on images yields `{type: 'image', source: {...}}` blocks
                  // with no text. Drop a minimal placeholder so the tool message
                  // has non-empty content (); richer image echo is a
                  // follow-up that needs structured ToolResultData.
                  if (c?.type === 'image') {
                    const mediaType = c.source?.media_type || 'image';
                    return `[Image: ${mediaType}]`;
                  }
                  return c.text || c.content || '';
                })
                .filter(Boolean)
                .join('\n')
            : JSON.stringify(block.content || '');

      // Synthesize pluginState for tools whose input IS (or, for Task*,
      // imperatively mutates) the target state. Two independent paths:
      //
      //  - TodoWrite: declarative snapshot — each call carries the complete
      //    list. The cached input is the synthesizable state.
      //  - TaskCreate / TaskUpdate / TaskList (CC 2.1.143+): imperative;
      //    the adapter accumulates them into `claudeCodeTasks` and snapshots
      //    that map.
      //
      // Guard on `is_error` for both: a failed write was never applied on
      // CC's side, so we must not persist a derived snapshot —
      // `selectTodosFromMessages` picks the latest `pluginState.todos` from
      // any producer, and leaking a failed write would overwrite the live
      // todo UI with changes that never actually happened. Drain the input
      // caches either way so a retry with a fresh tool_use id doesn't
      // inherit stale args. Subagent inner tools never participate (their
      // task state is per-subagent, not the main plan).
      const cachedTodoArgs = this.todoWriteInputs.get(toolCallId);
      if (cachedTodoArgs) this.todoWriteInputs.delete(toolCallId);
      const todoWritePluginState =
        cachedTodoArgs && !block.is_error
          ? synthesizeTodoWritePluginState(cachedTodoArgs)
          : undefined;

      const taskPluginState =
        subagentCtx === undefined
          ? this.applyTaskToolResult(toolCallId, !!block.is_error, resultContent)
          : undefined;

      const pluginState = todoWritePluginState ?? taskPluginState;

      // Emit tool_result for executor to persist content to tool message
      events.push(
        this.makeEvent('tool_result', {
          content: resultContent,
          isError: !!block.is_error,
          pluginState,
          subagent: subagentCtx,
          toolCallId,
        } satisfies ToolResultData),
      );

      // Then emit tool_end (signals handler to refresh tool result UI)
      if (this.pendingToolCalls.has(toolCallId)) {
        this.pendingToolCalls.delete(toolCallId);
        events.push(
          this.makeEvent('tool_end', {
            isSuccess: !block.is_error,
            subagent: subagentCtx,
            toolCallId,
          }),
        );
      }
    }

    return events;
  }

  /**
   * Apply a Task* tool_result to the running {@link claudeCodeTasks}
   * accumulator and return a fresh synthesized `pluginState.todos` snapshot.
   * Returns `undefined` if the tool_result was for a non-Task tool, was an
   * error, or carried no state change (the snapshot is identical to the
   * pre-call one — but we still emit it so the UI re-syncs).
   *
   * Drain the input caches even on error to keep long sessions bounded;
   * the accumulator itself only mutates on success so a failed TaskUpdate
   * doesn't leak partial state into the rendered todo list.
   */
  private applyTaskToolResult(
    toolCallId: string,
    isError: boolean,
    resultContent: string,
  ): SynthesizedTodoPluginState | undefined {
    const cachedCreate = this.taskCreateInputs.get(toolCallId);
    if (cachedCreate) this.taskCreateInputs.delete(toolCallId);
    const cachedUpdate = this.taskUpdateInputs.get(toolCallId);
    if (cachedUpdate) this.taskUpdateInputs.delete(toolCallId);
    const wasTaskList = this.pendingTaskListCalls.has(toolCallId);
    if (wasTaskList) this.pendingTaskListCalls.delete(toolCallId);

    if (!cachedCreate && !cachedUpdate && !wasTaskList) return undefined;
    if (isError) return undefined;

    if (cachedCreate) {
      // CC assigns the task id server-side; parse it from the confirmation
      // line so the accumulator keys match the ids the model will use in
      // later TaskUpdate calls. Skip silently on a non-matching format —
      // future CC versions might rephrase the confirmation, and leaking a
      // garbage entry is worse than missing one row.
      const match = TASK_CREATE_RESULT_PATTERN.exec(resultContent);
      if (match) {
        const taskId = match[1];
        this.claudeCodeTasks.set(taskId, {
          activeForm: cachedCreate.activeForm,
          description: cachedCreate.description,
          status: 'pending',
          subject: cachedCreate.subject,
        });
      }
    } else if (cachedUpdate) {
      // Only apply the update if CC confirmed it. `Updated task #N` is the
      // success line; any other shape implies a failure CC didn't surface
      // as `is_error`, in which case we leave the accumulator alone.
      if (!TASK_UPDATE_RESULT_PATTERN.test(resultContent)) return undefined;
      if (cachedUpdate.status === 'deleted') {
        this.claudeCodeTasks.delete(cachedUpdate.taskId);
      } else {
        const existing = this.claudeCodeTasks.get(cachedUpdate.taskId);
        // TaskUpdate against an id we never saw a Create for can happen in
        // resume sessions; seed a placeholder entry from whatever fields
        // the update carried so the next TaskList reconcile fills the rest.
        const next: ClaudeCodeTaskEntry = existing ?? {
          status: 'pending',
          subject: cachedUpdate.subject ?? `Task #${cachedUpdate.taskId}`,
        };
        // `deleted` is handled in the outer branch — TS narrows it out here.
        if (cachedUpdate.status) next.status = cachedUpdate.status;
        if (cachedUpdate.subject !== undefined) next.subject = cachedUpdate.subject;
        if (cachedUpdate.description !== undefined) next.description = cachedUpdate.description;
        if (cachedUpdate.activeForm !== undefined) next.activeForm = cachedUpdate.activeForm;
        this.claudeCodeTasks.set(cachedUpdate.taskId, next);
      }
    } else if (wasTaskList) {
      // Reconciliation: rebuild id / status / subject from each line of
      // CC's plain-text list. activeForm / description aren't recoverable
      // — keep whatever we already had (e.g. from a prior Create) and
      // fall back to subject for the in-progress spinner text.
      for (const rawLine of resultContent.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const m = TASK_LIST_LINE_PATTERN.exec(line);
        if (!m) continue;
        const [, taskId, status, subject] = m;
        const existing = this.claudeCodeTasks.get(taskId);
        if (existing) {
          existing.status = status as ClaudeCodeTodoStatus;
          existing.subject = subject;
        } else {
          this.claudeCodeTasks.set(taskId, {
            status: status as ClaudeCodeTodoStatus,
            subject,
          });
        }
      }
    }

    return synthesizeTaskPluginState(this.claudeCodeTasks);
  }

  private handleResult(raw: any): HeterogeneousAgentEvent[] {
    // Emit authoritative grand-total usage from CC's result event. The
    // executor currently ignores this phase (it persists per-turn via
    // turn_metadata), but we still emit it so other consumers — cost
    // displays, logs — can read the normalized total.
    const events: HeterogeneousAgentEvent[] = [];
    const usage = toUsageData(raw.usage);
    if (usage) {
      events.push(
        this.makeEvent('step_complete', {
          costUsd: raw.total_cost_usd,
          phase: 'result_usage',
          usage,
        }),
      );
    }

    const resultMessage = getCliResultMessage(raw.result) || 'Agent execution failed';
    const rateLimitError = getRateLimitTerminalError(raw.result, this.pendingRateLimitInfo);
    const finalEvent: HeterogeneousAgentEvent = raw.is_error
      ? this.makeEvent(
          'error',
          rateLimitError ||
            getOverloadedTerminalError(
              raw.result,
              raw.api_error_status,
              this.pendingRateLimitInfo,
            ) ||
            getAuthRequiredTerminalError(raw.result) || {
              error: resultMessage,
              message: resultMessage,
            },
        )
      : this.makeEvent('agent_runtime_end', {});

    this.pendingRateLimitInfo = undefined;
    this.streamedTextByMessageId.clear();
    this.streamedThinkingByMessageId.clear();
    // Drop any unconsumed task-completion lineage so the next LLM run
    // doesn't inherit it (e.g. a follow-up user turn would otherwise
    // wrongly inherit the previous run's task-completion tag).
    this.pendingTaskCompletion = undefined;

    return [
      ...events,
      this.makeEvent('stream_end', {}),
      this.makeEvent('visible_output_end', {}),
      finalEvent,
    ];
  }

  /**
   * Handle stream_event wrapper emitted under `--include-partial-messages`.
   * Surfaces text_delta / thinking_delta as incremental stream_chunk events
   * and keeps message-boundary state (stepIndex / currentMessageId) in sync
   * so subsequent assistant events don't re-open an already-known message.
   *
   * Tool-input (input_json_delta) deltas are ignored; tool_use is emitted as
   * a complete block via the `assistant` event to avoid half-parsed JSON in
   * the UI.
   */
  private handleStreamEvent(raw: any): HeterogeneousAgentEvent[] {
    const event = raw?.event;
    if (!event) return [];

    // Seeing any stream_event proves CC is running with
    // `--include-partial-messages` — `message_delta` owns authoritative usage,
    // so `handleAssistant` must NOT also emit it (the assistant block echoes a
    // stale message_start usage snapshot in this mode).
    this.sawStreamEvent = true;

    switch (event.type) {
      case 'message_start': {
        const msgId: string | undefined = event.message?.id;
        this.currentStreamEventMessageId = msgId;
        if (event.message?.model) this.currentStreamEventModel = event.message.model;
        return this.openMainMessage(msgId, event.message?.model);
      }
      case 'content_block_delta': {
        const delta = event.delta;
        if (!delta) return [];
        const msgId = this.currentStreamEventMessageId;
        if (delta.type === 'text_delta' && delta.text) {
          if (msgId) {
            this.streamedTextByMessageId.set(
              msgId,
              `${this.streamedTextByMessageId.get(msgId) ?? ''}${delta.text}`,
            );
          }
          return [this.makeChunkEvent({ chunkType: 'text', content: delta.text })];
        }
        if (delta.type === 'thinking_delta' && delta.thinking) {
          if (msgId) {
            this.streamedThinkingByMessageId.set(
              msgId,
              `${this.streamedThinkingByMessageId.get(msgId) ?? ''}${delta.thinking}`,
            );
          }
          return [this.makeChunkEvent({ chunkType: 'reasoning', reasoning: delta.thinking })];
        }
        return [];
      }
      case 'message_delta': {
        // Authoritative per-turn usage. CC echoes stale message_start usage on
        // every `assistant` event, so `handleAssistant` deliberately skips the
        // emission and lets this branch own it. `message_delta.usage` carries
        // the full final usage (input + cache + final output_tokens).
        const usage = toUsageData(event.usage);
        if (!usage) return [];
        return [
          this.makeEvent('step_complete', {
            model: this.currentStreamEventModel,
            phase: 'turn_metadata',
            provider: 'claude-code',
            usage,
          }),
        ];
      }
      default: {
        return [];
      }
    }
  }

  /**
   * Idempotent message-boundary opener called by both `handleAssistant` and
   * `handleStreamEvent(message_start)`. Ensures `stepIndex` advances and
   * `stream_end` / `stream_start(newStep)` fire on the FIRST signal of a new
   * message.id — whether that signal is a delta event or the complete
   * assistant event.
   *
   * - If `started === false`: auto-start (emit stream_start, record id).
   * - If `messageId === currentMessageId`: no-op.
   * - If this is the first message after a system-init stream_start: just
   *   record the id (init already primed the executor).
   * - Otherwise: advance stepIndex and emit stream_end + stream_start(newStep).
   */
  private openMainMessage(
    messageId: string | undefined,
    model: string | undefined,
    forcePostToolBoundary = false,
  ): HeterogeneousAgentEvent[] {
    if (!messageId) return [];

    if (!this.started) {
      this.started = true;
      this.currentMessageId = messageId;
      this.currentTurnHadToolUse = false;
      return [this.makeEvent('stream_start', { model, provider: 'claude-code' })];
    }

    if (messageId === this.currentMessageId) {
      // Same message.id ⇒ normally the same step (CC streams a turn's blocks
      // across several assistant events). EXCEPT when the model answers AFTER
      // its tools while reusing the id: that post-tool text must get its own
      // step, or it coalesces onto the tool-issuing assistant and the renderer
      // drops the tool block below the answer. This is a natural main-chain
      // continuation, NOT a signal callback, so emit a plain boundary without
      // the task-callback / external-signal tagging below.
      if (!forcePostToolBoundary) return [];
      this.stepIndex++;
      this.currentTurnHadToolUse = false;
      // The post-tool answer is the natural follow-up to the preceding
      // tool_result — consume the user-input flag exactly like the normal turn
      // boundary does (below), or a later signal callback (e.g. a Monitor stdout
      // turn opened while a task is active) would see a stale `true` and skip
      // its external-signal tag.
      this.hasUnhandledUserInput = false;
      this.pendingExternalSignal = undefined;
      // Reusing the tool turn's message.id as the newStep id would make the
      // reducer treat this as a REPLAY and drop it (it ignores a `newStep` whose
      // id === currentMainMessageId). For any tool turn opened by a prior
      // newStep that id already IS currentMainMessageId, so the split would be
      // dropped and the text would coalesce anyway. Stamp a DISTINCT,
      // replay-stable idempotency key — suffixed by stepIndex, so it is unique
      // per split and deterministic across cold-replica reprocessing — so a
      // fresh assistant is actually opened.
      return [
        this.makeEvent('stream_end', {}),
        this.makeEvent('stream_start', {
          messageId: `${messageId}:s${this.stepIndex}`,
          model,
          newStep: true,
          provider: 'claude-code',
        }),
      ];
    }

    if (this.currentMessageId === undefined) {
      // First assistant/delta after system init — record without step boundary.
      this.currentMessageId = messageId;
      this.currentTurnHadToolUse = false;
      return [];
    }

    this.currentMessageId = messageId;
    this.currentTurnHadToolUse = false;
    this.stepIndex++;
    // Signal-callback detection (): if this turn opened
    // WITHOUT a preceding `user` event AND a long-running task is
    // still active, the LLM was re-invoked by the task pushing an
    // update — tag the resulting assistant turn accordingly. Otherwise
    // it's a natural continuation (tool_result follow-up or
    // user-initiated turn).
    if (!this.hasUnhandledUserInput && this.activeTasks.size > 0) {
      // Pick the most recently registered active task. Multi-task
      // concurrency isn't expected in real Monitor flows but the Map
      // preserves insertion order so this still gives deterministic
      // behavior if it ever happens.
      const lastTaskKey = [...this.activeTasks.keys()].at(-1)!;
      const task = this.activeTasks.get(lastTaskKey)!;
      task.callbackCount += 1;
      this.pendingExternalSignal = {
        sequence: task.callbackCount,
        sourceToolCallId: task.toolUseId,
        sourceToolName: task.sourceToolName,
        type: 'tool-stdout',
      };
    } else if (this.pendingTaskCompletion) {
      // Natural turn that follows a `task_notification` — this is the
      // post-task summary. Tag it with the source-tool lineage so the
      // collector keeps it inside the same AssistantGroup as the
      // preceding callbacks (rendered after the SignalCallbacks block).
      this.pendingExternalSignal = {
        sourceToolCallId: this.pendingTaskCompletion.sourceToolCallId,
        sourceToolName: this.pendingTaskCompletion.sourceToolName,
        type: 'task-completion',
      };
      this.pendingTaskCompletion = undefined;
    } else {
      // Natural turn boundary — clear any stale signal so the new
      // assistant joins the main chain.
      this.pendingExternalSignal = undefined;
    }
    this.hasUnhandledUserInput = false;

    return [
      this.makeEvent('stream_end', {}),
      this.makeEvent('stream_start', {
        externalSignal: this.pendingExternalSignal,
        // The turn's CC message.id — the server stamps it on the new assistant
        // (`metadata.mainMessageId`) as a turn idempotency key, so a cold-replica
        // batch retry that reprocesses this `newStep` recognizes the same turn
        // instead of forking a duplicate + usage-only empty shell.
        messageId,
        model,
        newStep: true,
        provider: 'claude-code',
      }),
    ];
  }

  private getTrailingCompletion(
    messageId: string | undefined,
    fullContent: string,
    streamedByMessageId: Map<string, string>,
  ): string | undefined {
    if (!fullContent) return;
    if (!messageId) return fullContent;

    const streamed = streamedByMessageId.get(messageId);
    if (!streamed) return fullContent;
    if (fullContent === streamed) return;

    if (fullContent.startsWith(streamed)) {
      const suffix = fullContent.slice(streamed.length);
      return suffix || undefined;
    }
  }

  private clearStreamedBuffers(
    messageId: string,
    modes: { text?: boolean; thinking?: boolean },
  ): void {
    if (modes.text) this.streamedTextByMessageId.delete(messageId);
    if (modes.thinking) this.streamedThinkingByMessageId.delete(messageId);
  }

  // ─── Event factories ───

  private makeEvent(type: HeterogeneousAgentEvent['type'], data: any): HeterogeneousAgentEvent {
    return { data, stepIndex: this.stepIndex, timestamp: Date.now(), type };
  }

  private makeChunkEvent(data: StreamChunkData): HeterogeneousAgentEvent {
    return { data, stepIndex: this.stepIndex, timestamp: Date.now(), type: 'stream_chunk' };
  }
}

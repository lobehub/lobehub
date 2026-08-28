import { formatPatch, structuredPatch } from 'diff';

import type {
  AgentMessageDeltaNotification,
  CodexErrorInfo,
  CommandExecutionOutputDeltaNotification,
  ErrorNotification,
  FileChangePatchUpdatedNotification,
  FileUpdateChange,
  ItemCompletedNotification,
  ItemStartedNotification,
  McpToolCallProgressNotification,
  ReasoningSummaryTextDeltaNotification,
  ReasoningTextDeltaNotification,
  ThreadItem,
  ThreadTokenUsageUpdatedNotification,
  TokenUsageBreakdown,
  TurnCompletedNotification,
  TurnError,
  TurnPlanUpdatedNotification,
  TurnStartedNotification,
} from '../codex/protocol';
import type { HeteroErrorKind } from '../errors/specs';
import type {
  HeterogeneousAgentEvent,
  HeterogeneousTerminalErrorData,
  StepCompleteData,
  StreamStartData,
  ToolCallPayload,
  ToolResultData,
  ToolStateChunkData,
  UsageData,
} from '../types';
import {
  CODEX_COMMAND_OUTPUT_MAX_LENGTH,
  truncateCodexCommandOutput,
} from '../utils/codexCommandOutput';
import { toTurnUsageFromCumulative } from '../utils/codexUsage';

const CODEX_IDENTIFIER = 'codex';

type CommandItem = Extract<ThreadItem, { type: 'commandExecution' }>;
type AgentMessageItem = Extract<ThreadItem, { type: 'agentMessage' }>;
type ReasoningItem = Extract<ThreadItem, { type: 'reasoning' }>;
type FileChangeItem = Extract<ThreadItem, { type: 'fileChange' }>;
type McpToolItem = Extract<ThreadItem, { type: 'mcpToolCall' }>;
type DynamicToolItem = Extract<ThreadItem, { type: 'dynamicToolCall' }>;
type CollabToolItem = Extract<ThreadItem, { type: 'collabAgentToolCall' }>;
type WebSearchItem = Extract<ThreadItem, { type: 'webSearch' }>;
type ToolItem =
  CollabToolItem | CommandItem | DynamicToolItem | FileChangeItem | McpToolItem | WebSearchItem;

interface StreamedOutput {
  prefix: string;
  totalLength: number;
  truncated: boolean;
}

interface PlanState {
  id: string;
  items: Array<{ status: 'completed' | 'processing' | 'todo'; text: string }>;
}

interface CodexErrorClassification {
  code?: 'auth_required' | 'overloaded' | 'rate_limit';
  httpStatusCode?: number;
  kind: HeteroErrorKind;
}

const isToolItem = (item: ThreadItem): item is ToolItem =>
  item.type === 'collabAgentToolCall' ||
  item.type === 'commandExecution' ||
  item.type === 'dynamicToolCall' ||
  item.type === 'fileChange' ||
  item.type === 'mcpToolCall' ||
  item.type === 'webSearch';

const stringify = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const toApiName = (item: ToolItem): string => {
  switch (item.type) {
    case 'collabAgentToolCall': {
      return 'collab_tool_call';
    }
    case 'commandExecution': {
      return 'command_execution';
    }
    case 'dynamicToolCall': {
      return 'dynamic_tool_call';
    }
    case 'fileChange': {
      return 'file_change';
    }
    case 'mcpToolCall': {
      return 'mcp_tool_call';
    }
    case 'webSearch': {
      return 'web_search';
    }
  }
};

const toToolPayload = (item: ToolItem): ToolCallPayload => ({
  apiName: toApiName(item),
  arguments: JSON.stringify(
    item.type === 'commandExecution'
      ? { command: item.command }
      : item.type === 'mcpToolCall'
        ? { arguments: item.arguments, server: item.server, tool: item.tool }
        : item,
  ),
  id: item.id,
  identifier: CODEX_IDENTIFIER,
  type: 'default',
});

const toGitDiffPath = (prefix: 'a' | 'b', filePath: string): string =>
  filePath.startsWith('/') ? `${prefix}${filePath}` : `${prefix}/${filePath}`;

// App-server sends raw content for add/delete and headerless hunks for update.
// Normalize both forms to the complete single-file patch expected by PatchDiff.
const toCompleteFileDiff = (change: FileUpdateChange): string => {
  const sourcePath = toGitDiffPath('a', change.path);
  const destinationPath = toGitDiffPath(
    'b',
    change.kind.type === 'update' && change.kind.move_path ? change.kind.move_path : change.path,
  );
  const gitHeader = `diff --git ${sourcePath} ${destinationPath}`;

  if (change.kind.type === 'add' || change.kind.type === 'delete') {
    const patch = structuredPatch(
      change.kind.type === 'add' ? '/dev/null' : sourcePath,
      change.kind.type === 'delete' ? '/dev/null' : destinationPath,
      change.kind.type === 'delete' ? change.diff : '',
      change.kind.type === 'add' ? change.diff : '',
    );
    return `${gitHeader}\n${formatPatch(patch)}`;
  }

  const movePath = change.kind.move_path;
  const moveSuffix = movePath ? `\n\nMoved to: ${movePath}` : '';
  const hunks =
    moveSuffix && change.diff.endsWith(moveSuffix)
      ? change.diff.slice(0, -moveSuffix.length)
      : change.diff;

  return [gitHeader, `--- ${sourcePath}`, `+++ ${destinationPath}`, hunks]
    .filter(Boolean)
    .join('\n');
};

const toFileChangeState = (changes: FileUpdateChange[]) => ({
  changes: changes.map((change) => ({
    diffText: toCompleteFileDiff(change),
    kind: change.kind.type === 'update' && change.kind.move_path ? 'rename' : change.kind.type,
    path: change.path,
  })),
});

const toMcpContent = (item: McpToolItem): string => {
  if (item.error) return item.error.message;
  if (!item.result) return '';
  return item.result.content
    .map((content) => {
      if (typeof content === 'string') return content;
      if (content && typeof content === 'object' && 'text' in content) {
        return typeof content.text === 'string' ? content.text : stringify(content);
      }
      return stringify(content);
    })
    .filter(Boolean)
    .join('\n\n');
};

const getWebSearchQuery = (item: WebSearchItem): string => {
  if (item.query) return item.query;
  if (item.action?.type === 'search') {
    return item.action.query || item.action.queries?.[0] || '';
  }
  return '';
};

const isSuccessful = (item: ToolItem): boolean => {
  switch (item.type) {
    case 'commandExecution': {
      return item.status === 'completed' && (item.exitCode === null || item.exitCode === 0);
    }
    case 'dynamicToolCall': {
      return item.status === 'completed' && item.success !== false;
    }
    case 'mcpToolCall': {
      return item.status === 'completed' && !item.error;
    }
    case 'webSearch': {
      return true;
    }
    default: {
      return item.status === 'completed';
    }
  }
};

const toToolResult = (item: ToolItem): ToolResultData => {
  const success = isSuccessful(item);

  switch (item.type) {
    case 'commandExecution': {
      const output = truncateCodexCommandOutput(item.aggregatedOutput ?? '');
      return {
        content: output.output,
        isError: !success,
        pluginState: {
          ...(item.exitCode === null ? {} : { exitCode: item.exitCode }),
          isBackground: false,
          ...(output.truncated
            ? {
                omittedOutputCharacters: output.omittedCharacters,
                originalOutputLength: output.originalLength,
                outputTruncated: true,
              }
            : {}),
          output: output.output,
          stdout: output.output,
          success,
        },
        toolCallId: item.id,
      };
    }
    case 'fileChange': {
      return {
        content: success ? 'File changes applied.' : 'File changes failed.',
        isError: !success,
        pluginState: toFileChangeState(item.changes),
        toolCallId: item.id,
      };
    }
    case 'mcpToolCall': {
      return {
        content: toMcpContent(item),
        isError: !success,
        pluginState: {
          arguments: item.arguments,
          error: item.error,
          result: item.result,
          server: item.server,
          status: item.status,
          tool: item.tool,
        },
        toolCallId: item.id,
      };
    }
    case 'webSearch': {
      return {
        content: 'Completed web_search.',
        isError: false,
        pluginState: {
          action: item.action,
          query: getWebSearchQuery(item),
          results: item.results,
          status: 'completed',
        },
        toolCallId: item.id,
      };
    }
    case 'dynamicToolCall': {
      const content = item.contentItems
        ?.map((entry) => (entry.type === 'inputText' ? entry.text : stringify(entry)))
        .join('\n\n');
      return {
        content: content || `${item.tool} ${success ? 'completed' : 'failed'}.`,
        isError: !success,
        pluginState: {
          arguments: item.arguments,
          contentItems: item.contentItems,
          namespace: item.namespace,
          status: item.status,
          success: item.success,
          tool: item.tool,
        },
        toolCallId: item.id,
      };
    }
    case 'collabAgentToolCall': {
      return {
        content: `${item.tool} ${success ? 'completed' : 'failed'}.`,
        isError: !success,
        pluginState: {
          agents_states: item.agentsStates,
          prompt: item.prompt,
          receiver_thread_ids: item.receiverThreadIds,
          sender_thread_id: item.senderThreadId,
          status: item.status,
          tool: item.tool,
        },
        toolCallId: item.id,
      };
    }
  }
};

const toUsage = (usage: TokenUsageBreakdown): UsageData | undefined => {
  const totalInputTokens = Math.max(usage.inputTokens, usage.cachedInputTokens);
  const totalOutputTokens = usage.outputTokens;
  if (totalInputTokens + totalOutputTokens === 0) return;

  return {
    inputCachedTokens: usage.cachedInputTokens || undefined,
    inputCacheMissTokens: Math.max(0, totalInputTokens - usage.cachedInputTokens),
    inputWriteCacheTokens: usage.cacheWriteInputTokens || undefined,
    outputReasoningTokens: usage.reasoningOutputTokens || undefined,
    outputTextTokens: Math.max(0, totalOutputTokens - usage.reasoningOutputTokens),
    totalInputTokens,
    totalOutputTokens,
    totalTokens: usage.totalTokens || totalInputTokens + totalOutputTokens,
  };
};

const classifyCodexError = (info: CodexErrorInfo | null): CodexErrorClassification => {
  if (typeof info === 'object' && info) {
    if ('activeTurnNotSteerable' in info) return { kind: 'agent_failed' };
    const connection =
      'httpConnectionFailed' in info
        ? info.httpConnectionFailed
        : 'responseStreamConnectionFailed' in info
          ? info.responseStreamConnectionFailed
          : 'responseStreamDisconnected' in info
            ? info.responseStreamDisconnected
            : info.responseTooManyFailedAttempts;
    return {
      code: 'overloaded',
      ...(connection.httpStatusCode === null ? {} : { httpStatusCode: connection.httpStatusCode }),
      kind: 'network_drop',
    };
  }

  switch (info) {
    case 'sessionBudgetExceeded':
    case 'usageLimitExceeded': {
      return { code: 'rate_limit', kind: 'usage_limit' };
    }
    case 'internalServerError':
    case 'serverOverloaded': {
      return { code: 'overloaded', kind: 'server_overloaded' };
    }
    case 'unauthorized': {
      return { code: 'auth_required', kind: 'auth_required' };
    }
    case 'badRequest':
    case 'contextWindowExceeded':
    case 'cyberPolicy': {
      return { kind: 'invalid_request' };
    }
    default: {
      return { kind: 'agent_failed' };
    }
  }
};

/** Direct app-server v2 notification → unified heterogeneous event adapter. */
export class CodexAppServerAdapter {
  private currentAgentMessageItemId?: string;
  private currentModel?: string;
  private hasTextInCurrentStep = false;
  private hasToolActivity = false;
  private lastCumulativeUsage?: UsageData;
  private latestCumulativeUsage?: UsageData;
  private latestPlan?: PlanState;
  private readonly pendingTools = new Map<string, ToolCallPayload>();
  private readonly streamedAgentText = new Map<string, string>();
  private readonly streamedCommandOutput = new Map<string, StreamedOutput>();
  private readonly streamedReasoning = new Set<string>();
  private readonly toolStateSequence = new Map<string, number>();
  private stepToolCalls: ToolCallPayload[] = [];
  private started = false;
  private stepIndex = 0;
  private terminal = false;

  constructor(options: { initialCumulativeUsage?: UsageData; initialModel?: string } = {}) {
    this.currentModel = options.initialModel;
    this.lastCumulativeUsage = options.initialCumulativeUsage;
  }

  get cumulativeUsage(): UsageData | undefined {
    return this.latestCumulativeUsage ?? this.lastCumulativeUsage;
  }

  configureModel(model: string): HeterogeneousAgentEvent[] {
    if (model === this.currentModel) return [];
    this.currentModel = model;
    return [this.makeEvent('step_complete', this.turnMetadata())];
  }

  adapt(method: string, rawParams: unknown): HeterogeneousAgentEvent[] {
    if (this.terminal) return [];

    switch (method) {
      case 'turn/started': {
        return this.handleTurnStarted(rawParams as TurnStartedNotification);
      }
      case 'item/started': {
        return this.handleItemStarted(rawParams as ItemStartedNotification);
      }
      case 'item/completed': {
        return this.handleItemCompleted(rawParams as ItemCompletedNotification);
      }
      case 'item/agentMessage/delta': {
        return this.handleAgentMessageDelta(rawParams as AgentMessageDeltaNotification);
      }
      case 'item/reasoning/summaryTextDelta': {
        return this.handleReasoningDelta(rawParams as ReasoningSummaryTextDeltaNotification);
      }
      case 'item/reasoning/textDelta': {
        return this.handleReasoningDelta(rawParams as ReasoningTextDeltaNotification);
      }
      case 'item/commandExecution/outputDelta': {
        return this.handleCommandOutput(rawParams as CommandExecutionOutputDeltaNotification);
      }
      case 'item/fileChange/patchUpdated': {
        return this.handleFileChangeUpdate(rawParams as FileChangePatchUpdatedNotification);
      }
      case 'item/mcpToolCall/progress': {
        return this.handleMcpProgress(rawParams as McpToolCallProgressNotification);
      }
      case 'turn/plan/updated': {
        return this.handlePlanUpdated(rawParams as TurnPlanUpdatedNotification);
      }
      case 'thread/tokenUsage/updated': {
        this.latestCumulativeUsage = toUsage(
          (rawParams as ThreadTokenUsageUpdatedNotification).tokenUsage.total,
        );
        return [];
      }
      case 'error': {
        return this.handleError(rawParams as ErrorNotification);
      }
      case 'turn/completed': {
        return this.handleTurnCompleted(rawParams as TurnCompletedNotification);
      }
      default: {
        return [];
      }
    }
  }

  flush(): HeterogeneousAgentEvent[] {
    return this.drainPendingTools();
  }

  /** A crashed transport cannot recover its in-flight turn, but the thread remains resumable. */
  interruptForTransportFailure(): HeterogeneousAgentEvent[] {
    return this.completeTurn('interrupted');
  }

  private handleTurnStarted(_params: TurnStartedNotification): HeterogeneousAgentEvent[] {
    if (this.started) return [];
    this.started = true;
    return [this.makeEvent('stream_start', this.streamStartData())];
  }

  private handleItemStarted({ item }: ItemStartedNotification): HeterogeneousAgentEvent[] {
    if (!isToolItem(item)) return [];
    this.hasToolActivity = true;
    const payload = toToolPayload(item);
    this.pendingTools.set(item.id, payload);
    this.stepToolCalls.push(payload);
    return [
      this.makeEvent('stream_chunk', {
        chunkType: 'tools_calling',
        toolsCalling: [...this.stepToolCalls],
      }),
      this.makeEvent('tool_start', { toolCallId: item.id }),
    ];
  }

  private handleItemCompleted({ item }: ItemCompletedNotification): HeterogeneousAgentEvent[] {
    if (item.type === 'agentMessage') {
      const message = item as AgentMessageItem;
      const streamed = this.streamedAgentText.get(message.id);
      this.streamedAgentText.delete(message.id);
      if (streamed !== undefined) {
        const remainder = message.text.startsWith(streamed)
          ? message.text.slice(streamed.length)
          : '';
        return remainder ? this.emitText(message.id, remainder) : [];
      }
      return message.text ? this.emitText(message.id, message.text) : [];
    }
    if (item.type === 'reasoning') {
      const reasoningItem = item as ReasoningItem;
      if (this.streamedReasoning.delete(reasoningItem.id)) return [];
      const reasoning = [...reasoningItem.summary, ...reasoningItem.content]
        .filter(Boolean)
        .join('\n\n');
      return reasoning ? this.emitReasoning(reasoningItem.id, reasoning) : [];
    }
    if (!isToolItem(item)) return [];

    this.streamedCommandOutput.delete(item.id);
    const payload = this.pendingTools.get(item.id) ?? toToolPayload(item);
    const events = this.pendingTools.has(item.id) ? [] : this.startLateTool(payload);
    this.pendingTools.delete(item.id);
    const result = toToolResult(item);
    const success = isSuccessful(item);
    events.push(
      this.makeEvent('tool_result', result),
      this.makeEvent('tool_end', {
        isSuccess: success,
        payload: { toolCalling: payload },
        result: {
          content: result.content,
          success,
          ...(result.pluginState ? { state: result.pluginState } : {}),
        },
        toolCallId: item.id,
      }),
    );
    return events;
  }

  private handleAgentMessageDelta(
    params: AgentMessageDeltaNotification,
  ): HeterogeneousAgentEvent[] {
    this.streamedAgentText.set(
      params.itemId,
      `${this.streamedAgentText.get(params.itemId) ?? ''}${params.delta}`,
    );
    return params.delta ? this.emitText(params.itemId, params.delta) : [];
  }

  private handleReasoningDelta(
    params: ReasoningSummaryTextDeltaNotification | ReasoningTextDeltaNotification,
  ): HeterogeneousAgentEvent[] {
    if (!params.delta) return [];
    this.streamedReasoning.add(params.itemId);
    return this.emitReasoning(params.itemId, params.delta);
  }

  private handleCommandOutput(
    params: CommandExecutionOutputDeltaNotification,
  ): HeterogeneousAgentEvent[] {
    if (!params.delta || !this.pendingTools.has(params.itemId)) return [];
    const previous = this.streamedCommandOutput.get(params.itemId) ?? {
      prefix: '',
      totalLength: 0,
      truncated: false,
    };
    const remaining = Math.max(0, CODEX_COMMAND_OUTPUT_MAX_LENGTH - previous.prefix.length);
    const prefix = previous.prefix + params.delta.slice(0, remaining);
    const totalLength = previous.totalLength + params.delta.length;
    const truncated = totalLength > prefix.length;
    this.streamedCommandOutput.set(params.itemId, { prefix, totalLength, truncated });
    if (previous.truncated) return [];

    const output = truncated
      ? `${prefix}\n\n[Output truncated: ${totalLength - prefix.length} characters omitted. Original length: ${totalLength} characters]`
      : prefix;
    return [
      this.toolState(params.itemId, {
        isBackground: false,
        output,
        stdout: output,
      }),
    ];
  }

  private handleFileChangeUpdate(
    params: FileChangePatchUpdatedNotification,
  ): HeterogeneousAgentEvent[] {
    return this.pendingTools.has(params.itemId)
      ? [this.toolState(params.itemId, toFileChangeState(params.changes))]
      : [];
  }

  private handleMcpProgress(params: McpToolCallProgressNotification): HeterogeneousAgentEvent[] {
    return this.pendingTools.has(params.itemId)
      ? [this.toolState(params.itemId, { message: params.message, status: 'inProgress' })]
      : [];
  }

  private handlePlanUpdated(params: TurnPlanUpdatedNotification): HeterogeneousAgentEvent[] {
    const id = `turn-plan-${params.turnId}`;
    let foundProcessing = false;
    const plan: PlanState = {
      id,
      items: params.plan.map(({ status, step }) => {
        if (status === 'completed') return { status: 'completed', text: step };
        if (!foundProcessing && status === 'inProgress') {
          foundProcessing = true;
          return { status: 'processing', text: step };
        }
        return { status: 'todo', text: step };
      }),
    };
    const events: HeterogeneousAgentEvent[] = [];
    if (!this.latestPlan) {
      const payload: ToolCallPayload = {
        apiName: 'todo_list',
        arguments: JSON.stringify({ items: plan.items }),
        id,
        identifier: CODEX_IDENTIFIER,
        type: 'default',
      };
      this.pendingTools.set(id, payload);
      this.stepToolCalls.push(payload);
      this.hasToolActivity = true;
      events.push(
        this.makeEvent('stream_chunk', {
          chunkType: 'tools_calling',
          toolsCalling: [...this.stepToolCalls],
        }),
        this.makeEvent('tool_start', { toolCallId: id }),
      );
    }
    this.latestPlan = plan;
    events.push(
      this.toolState(id, { todos: { items: plan.items, updatedAt: new Date().toISOString() } }),
    );
    return events;
  }

  private handleError(params: ErrorNotification): HeterogeneousAgentEvent[] {
    if (params.willRetry) {
      return [this.makeEvent('stream_retry', { message: params.error.message })];
    }
    return this.terminalError(params.error);
  }

  private handleTurnCompleted({ turn }: TurnCompletedNotification): HeterogeneousAgentEvent[] {
    if (turn.status === 'failed') {
      return this.terminalError(
        turn.error ?? {
          additionalDetails: null,
          codexErrorInfo: null,
          message: 'Codex execution failed',
        },
      );
    }
    if (turn.status !== 'completed' && turn.status !== 'interrupted') return [];

    return this.completeTurn(turn.status);
  }

  private completeTurn(status: 'completed' | 'interrupted'): HeterogeneousAgentEvent[] {
    if (this.terminal) return [];
    this.terminal = true;
    const events = [
      ...(status === 'completed' ? this.completePlan() : []),
      ...this.drainPendingTools(),
    ];
    const usage = toTurnUsageFromCumulative(this.latestCumulativeUsage, this.lastCumulativeUsage);
    if (usage || this.currentModel) {
      events.push(this.makeEvent('step_complete', this.turnMetadata(usage)));
    }
    if (this.started) {
      events.push(this.makeEvent('stream_end', {}), this.makeEvent('visible_output_end', {}));
    }
    events.push(
      this.makeEvent(
        'agent_runtime_end',
        status === 'interrupted' ? { reason: 'interrupted' } : {},
      ),
    );
    return events;
  }

  private emitText(itemId: string, content: string): HeterogeneousAgentEvent[] {
    const events = this.prepareVisibleContent(itemId);
    const chunk =
      this.hasTextInCurrentStep && itemId !== this.currentAgentMessageItemId
        ? `\n\n${content}`
        : content;
    this.currentAgentMessageItemId = itemId;
    this.hasTextInCurrentStep = true;
    events.push(this.makeEvent('stream_chunk', { chunkType: 'text', content: chunk }));
    return events;
  }

  private emitReasoning(itemId: string, reasoning: string): HeterogeneousAgentEvent[] {
    const events = this.prepareVisibleContent(itemId);
    events.push(this.makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning }));
    return events;
  }

  private prepareVisibleContent(_itemId: string): HeterogeneousAgentEvent[] {
    if (!this.hasToolActivity) return [];
    this.hasToolActivity = false;
    this.stepIndex += 1;
    this.stepToolCalls = [];
    this.hasTextInCurrentStep = false;
    this.currentAgentMessageItemId = undefined;
    return [
      this.makeEvent('stream_end', {}),
      this.makeEvent('stream_start', this.streamStartData({ newStep: true })),
    ];
  }

  private startLateTool(payload: ToolCallPayload): HeterogeneousAgentEvent[] {
    this.stepToolCalls.push(payload);
    return [
      this.makeEvent('stream_chunk', {
        chunkType: 'tools_calling',
        toolsCalling: [...this.stepToolCalls],
      }),
      this.makeEvent('tool_start', { toolCallId: payload.id }),
    ];
  }

  private completePlan(): HeterogeneousAgentEvent[] {
    const plan = this.latestPlan;
    if (!plan || !this.pendingTools.has(plan.id)) return [];
    this.pendingTools.delete(plan.id);
    const pluginState = {
      todos: {
        items: plan.items.map((item) => ({ ...item, status: 'completed' })),
        updatedAt: new Date().toISOString(),
      },
    };
    return [
      this.makeEvent('tool_result', {
        content: 'Todo list completed.',
        pluginState,
        toolCallId: plan.id,
      } satisfies ToolResultData),
      this.makeEvent('tool_end', { isSuccess: true, toolCallId: plan.id }),
    ];
  }

  private drainPendingTools(): HeterogeneousAgentEvent[] {
    const events = [...this.pendingTools.keys()].map((toolCallId) =>
      this.makeEvent('tool_end', { isSuccess: false, toolCallId }),
    );
    this.pendingTools.clear();
    return events;
  }

  private terminalError(error: TurnError): HeterogeneousAgentEvent[] {
    if (this.terminal) return [];
    this.terminal = true;
    const classification = classifyCodexError(error.codexErrorInfo);
    const details = {
      ...(error.additionalDetails ? { additionalDetails: error.additionalDetails } : {}),
      ...(error.codexErrorInfo ? { codexErrorInfo: error.codexErrorInfo } : {}),
      ...(classification.httpStatusCode === undefined
        ? {}
        : { httpStatusCode: classification.httpStatusCode }),
      kind: classification.kind,
    };
    const events = this.drainPendingTools();
    if (this.started) {
      events.push(this.makeEvent('stream_end', {}), this.makeEvent('visible_output_end', {}));
    }
    events.push(
      this.makeEvent('error', {
        agentType: CODEX_IDENTIFIER,
        clearEchoedContent: true,
        ...(classification.code ? { code: classification.code } : {}),
        details,
        error: error.message,
        message: error.message,
        stderr: error.message,
      } satisfies HeterogeneousTerminalErrorData),
    );
    return events;
  }

  private toolState(toolCallId: string, pluginState: Record<string, unknown>) {
    const snapshotSeq = (this.toolStateSequence.get(toolCallId) ?? 0) + 1;
    this.toolStateSequence.set(toolCallId, snapshotSeq);
    return this.makeEvent('stream_chunk', {
      chunkType: 'tool_state',
      pluginState,
      snapshotMode: 'replace',
      snapshotSeq,
      toolCallId,
    } satisfies ToolStateChunkData);
  }

  private turnMetadata(usage?: UsageData): StepCompleteData {
    return {
      ...(this.currentModel ? { model: this.currentModel } : {}),
      phase: 'turn_metadata',
      provider: CODEX_IDENTIFIER,
      ...(usage ? { usage } : {}),
    };
  }

  private streamStartData(extra: Record<string, unknown> = {}): StreamStartData {
    return {
      ...(this.currentModel ? { model: this.currentModel } : {}),
      provider: CODEX_IDENTIFIER,
      ...extra,
    };
  }

  private makeEvent(type: HeterogeneousAgentEvent['type'], data: unknown): HeterogeneousAgentEvent {
    return { data, stepIndex: this.stepIndex, timestamp: Date.now(), type };
  }
}

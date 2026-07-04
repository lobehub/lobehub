import type {
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  HeterogeneousRateLimitInfo,
  HeterogeneousTerminalErrorData,
  StepCompleteData,
  StreamStartData,
  ToolCallPayload,
  ToolResultData,
  UsageData,
} from '../types';
import { toCodexUsageData, toTurnUsageFromCumulative } from '../utils/codexUsage';

const CODEX_IDENTIFIER = 'codex';
const CODEX_COLLAB_TOOL_CALL_API = 'collab_tool_call';
const CODEX_COMMAND_API = 'command_execution';
const CODEX_FILE_CHANGE_API = 'file_change';
const CODEX_MCP_TOOL_CALL_API = 'mcp_tool_call';
const CODEX_TODO_LIST_API = 'todo_list';
const CODEX_WEB_SEARCH_API = 'web_search';
const CODEX_USAGE_SETTINGS_URL = 'https://chatgpt.com/codex/settings/usage';
const CODEX_COMMAND_OUTPUT_MAX_LENGTH = 25_000;

const CODEX_USER_RATE_LIMIT_PATTERNS = [
  /you'?ve hit your usage limit/i,
  /purchase more credits/i,
  /\busage limit\b/i,
] as const;

const CODEX_RETRY_AT_PATTERN =
  /\btry again at\s+(\d{1,2})(?::(\d{2}))?(?:(AM|PM)|\s+(AM|PM))?(?:\s+\(([^()]+)\))?/i;

interface CodexBaseItem {
  id: string;
  status?: string;
  type: string;
}

interface CodexCommandExecutionItem extends CodexBaseItem {
  aggregated_output?: string;
  command?: string;
  exit_code?: number | null;
}

interface CodexTodoListEntry {
  completed?: boolean;
  text?: string;
}

interface CodexTodoListItem extends CodexBaseItem {
  items?: CodexTodoListEntry[];
}

interface CodexFileChangeEntry {
  diffText?: string;
  kind?: string;
  linesAdded?: number;
  linesDeleted?: number;
  path?: string;
}

interface CodexFileChangeItem extends CodexBaseItem {
  changes?: CodexFileChangeEntry[];
  diffText?: string;
  linesAdded?: number;
  linesDeleted?: number;
}

interface CodexMcpToolCallItem extends CodexBaseItem {
  arguments?: unknown;
  error?: unknown;
  result?: unknown;
  server?: string;
  tool?: string;
}

interface CodexWebSearchItem extends CodexBaseItem {
  action?: unknown;
  query?: unknown;
}

interface CodexCollabAgentState {
  message?: string | null;
  status?: string;
}

interface CodexCollabToolCallItem extends CodexBaseItem {
  agents_states?: Record<string, CodexCollabAgentState>;
  prompt?: string | null;
  receiver_thread_ids?: string[];
  sender_thread_id?: string;
  tool?: string;
}

type CodexToolItem =
  | CodexBaseItem
  | CodexCollabToolCallItem
  | CodexCommandExecutionItem
  | CodexFileChangeItem
  | CodexMcpToolCallItem
  | CodexTodoListItem
  | CodexWebSearchItem;

interface ZonedDateTimeParts {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
}

const isCommandExecutionItem = (item: CodexToolItem): item is CodexCommandExecutionItem =>
  item.type === CODEX_COMMAND_API;

const isCollabToolCallItem = (item: CodexToolItem): item is CodexCollabToolCallItem =>
  item.type === CODEX_COLLAB_TOOL_CALL_API;

const isFileChangeItem = (item: CodexToolItem): item is CodexFileChangeItem =>
  item.type === CODEX_FILE_CHANGE_API;

const isMcpToolCallItem = (item: CodexToolItem): item is CodexMcpToolCallItem =>
  item.type === CODEX_MCP_TOOL_CALL_API;

const isTodoListItem = (item: CodexToolItem): item is CodexTodoListItem =>
  item.type === CODEX_TODO_LIST_API;

const isWebSearchItem = (item: CodexToolItem): item is CodexWebSearchItem =>
  item.type === CODEX_WEB_SEARCH_API;

const normalizeTodoListItems = (item: CodexTodoListItem) =>
  (item.items || [])
    .map((todo) => ({
      completed: !!todo.completed,
      text: typeof todo.text === 'string' ? todo.text.trim() : '',
    }))
    .filter((todo) => todo.text.length > 0);

/**
 * Codex's `todo_list` only exposes a boolean completed flag. To light up the
 * shared todo progress UI, treat the first incomplete item as the active one
 * and the remaining incomplete items as pending.
 */
const synthesizeTodoListPluginState = (item: CodexTodoListItem) => {
  const todos = normalizeTodoListItems(item);
  if (todos.length === 0) return;

  let assignedProcessing = false;
  const items = todos.map((todo) => {
    if (todo.completed) return { status: 'completed', text: todo.text } as const;
    if (!assignedProcessing) {
      assignedProcessing = true;
      return { status: 'processing', text: todo.text } as const;
    }
    return { status: 'todo', text: todo.text } as const;
  });

  return {
    todos: {
      items,
      updatedAt: new Date().toISOString(),
    },
  };
};

const synthesizeFileChangePluginState = (item: CodexFileChangeItem) => {
  const changes = (item.changes || []).map((change) => ({
    ...(change.diffText ? { diffText: change.diffText } : {}),
    kind: change.kind,
    linesAdded: change.linesAdded ?? 0,
    linesDeleted: change.linesDeleted ?? 0,
    path: change.path,
  }));

  if (changes.length === 0 && item.linesAdded === undefined && item.linesDeleted === undefined) {
    return;
  }

  return {
    changes,
    ...(item.diffText ? { diffText: item.diffText } : {}),
    linesAdded: item.linesAdded ?? 0,
    linesDeleted: item.linesDeleted ?? 0,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringifyUnknown = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getRecordString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

const getFirstStringFromArray = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return;

  for (const item of value) {
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
};

const getWebSearchActionQuery = (action: Record<string, unknown>): string | undefined =>
  getRecordString(action, 'query')?.trim() || getFirstStringFromArray(action.queries);

const getWebSearchQuery = (item: CodexWebSearchItem): string | undefined => {
  if (typeof item.query === 'string' && item.query.trim()) return item.query.trim();

  return isRecord(item.action) ? getWebSearchActionQuery(item.action) : undefined;
};

const synthesizeWebSearchPluginState = (item: CodexWebSearchItem) => {
  const query = getWebSearchQuery(item);

  if (item.action === undefined && !query && !item.status) return;

  return {
    ...(item.action === undefined ? {} : { action: item.action }),
    ...(query ? { query } : {}),
    ...(item.status ? { status: item.status } : {}),
  };
};

const unwrapMcpResultEnvelope = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  if ('Ok' in value) return value.Ok;
  if ('Err' in value) return value.Err;
  if ('ok' in value) return value.ok;

  return value;
};

const getMcpContentItemText = (item: unknown): string => {
  if (typeof item === 'string') return item;
  if (!isRecord(item)) return stringifyUnknown(item);

  const text = getRecordString(item, 'text') || getRecordString(item, 'content');
  if (text) return text;

  return stringifyUnknown(item);
};

const getMcpResultContent = (item: CodexMcpToolCallItem): string => {
  const result = unwrapMcpResultEnvelope(item.result);

  if (Array.isArray(result)) {
    return result.map(getMcpContentItemText).filter(Boolean).join('\n\n');
  }

  if (isRecord(result)) {
    if (Array.isArray(result.content)) {
      return result.content.map(getMcpContentItemText).filter(Boolean).join('\n\n');
    }

    const text = getRecordString(result, 'text') || getRecordString(result, 'output');
    if (text) return text;
  }

  return stringifyUnknown(result);
};

const getMcpErrorContent = (item: CodexMcpToolCallItem): string => {
  const error = item.error || unwrapMcpResultEnvelope(item.result);

  if (isRecord(error)) {
    return (
      getRecordString(error, 'message') ||
      getRecordString(error, 'error') ||
      stringifyUnknown(error)
    );
  }

  return stringifyUnknown(error);
};

const hasMcpResultError = (item: CodexMcpToolCallItem): boolean => {
  if (item.error) return true;

  const result = item.result;
  if (!isRecord(result)) return false;
  if ('Err' in result) return true;

  const ok = unwrapMcpResultEnvelope(result);
  return isRecord(ok) && ok.isError === true;
};

const synthesizeMcpToolPluginState = (item: CodexMcpToolCallItem) => ({
  arguments: item.arguments,
  error: item.error,
  result: item.result,
  server: item.server,
  status: item.status,
  tool: item.tool,
});

const synthesizeCollabToolPluginState = (item: CodexCollabToolCallItem) => ({
  agents_states: item.agents_states,
  prompt: item.prompt,
  receiver_thread_ids: item.receiver_thread_ids,
  sender_thread_id: item.sender_thread_id,
  status: item.status,
  tool: item.tool,
});

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  count === 1 ? singular : plural;

const toMcpToolPayloadArguments = (item: CodexMcpToolCallItem) => ({
  arguments: item.arguments,
  server: item.server,
  tool: item.tool,
});

const toToolPayload = (item: CodexToolItem): ToolCallPayload => ({
  apiName: item.type || CODEX_COMMAND_API,
  arguments: JSON.stringify(
    isCommandExecutionItem(item)
      ? { command: item.command || '' }
      : isMcpToolCallItem(item)
        ? toMcpToolPayloadArguments(item)
        : item,
  ),
  id: item.id,
  identifier: CODEX_IDENTIFIER,
  type: 'default',
});

const getFileChangeKind = (kind?: string) => {
  switch (kind) {
    case 'add': {
      return 'added';
    }
    case 'delete':
    case 'remove': {
      return 'deleted';
    }
    case 'rename': {
      return 'renamed';
    }
    default: {
      return 'modified';
    }
  }
};

const summarizeTodoList = (item: CodexTodoListItem): string => {
  const todos = normalizeTodoListItems(item);
  if (todos.length === 0) return 'Todo list updated.';

  const completed = todos.filter((todo) => todo.completed).length;
  return `Todo list updated (${completed}/${todos.length} completed).`;
};

const summarizeFileChange = (item: CodexFileChangeItem): string => {
  const counts = new Map<string, number>();

  for (const change of item.changes || []) {
    const kind = getFileChangeKind(change.kind);
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }

  const totalChanges = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (totalChanges === 0) return 'File changes applied.';

  const parts = [...counts.entries()].map(([kind, count]) => `${count} ${kind}`);
  const statsSuffix =
    item.linesAdded || item.linesDeleted
      ? `, +${item.linesAdded || 0} -${item.linesDeleted || 0}`
      : '';

  return `File changes applied (${parts.join(', ')}${statsSuffix}).`;
};

const summarizeCollabToolCall = (item: CodexCollabToolCallItem): string => {
  const toolName = item.tool || 'collaboration';
  const agentStates = Object.values(item.agents_states || {});
  const agentCount = item.receiver_thread_ids?.length || agentStates.length;
  const completedMessage = agentStates.find(
    (state) => state.status === 'completed' && typeof state.message === 'string' && state.message,
  )?.message;

  if (toolName === 'spawn_agent') {
    return agentCount > 0
      ? `Spawned ${agentCount} ${pluralize(agentCount, 'subagent')}.`
      : 'Spawned subagent.';
  }

  if (toolName === 'wait') {
    if (completedMessage) return `Wait completed: ${completedMessage}`;
    return agentCount > 0
      ? `Wait completed for ${agentCount} ${pluralize(agentCount, 'subagent')}.`
      : 'Wait completed.';
  }

  return `${toolName} completed.`;
};

const summarizeWebSearch = (item: CodexWebSearchItem): string => {
  return `Completed ${item.type}.`;
};

const summarizeFallbackTool = (item: CodexToolItem): string => {
  return `Completed ${item.type}.`;
};

const getFailureVerb = (item: CodexToolItem): 'cancelled' | 'failed' =>
  item.status === 'cancelled' ? 'cancelled' : 'failed';

const getToolFailureContent = (item: CodexToolItem): string => {
  if (isTodoListItem(item)) return `Todo list update ${getFailureVerb(item)}.`;
  if (isFileChangeItem(item)) return `File changes ${getFailureVerb(item)}.`;
  if (isMcpToolCallItem(item)) {
    return getMcpErrorContent(item) || `MCP tool ${getFailureVerb(item)}.`;
  }
  if (isCollabToolCallItem(item)) return `${item.tool || 'Collaboration'} ${getFailureVerb(item)}.`;

  return `${item.type} ${getFailureVerb(item)}.`;
};

const getToolContent = (item: CodexToolItem, isSuccess: boolean): string => {
  if (isCommandExecutionItem(item)) {
    return typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
  }

  if (!isSuccess) return getToolFailureContent(item);

  if (isTodoListItem(item)) return summarizeTodoList(item);
  if (isFileChangeItem(item)) return summarizeFileChange(item);
  if (isMcpToolCallItem(item)) return getMcpResultContent(item);
  if (isCollabToolCallItem(item)) return summarizeCollabToolCall(item);
  if (isWebSearchItem(item)) return summarizeWebSearch(item);

  return summarizeFallbackTool(item);
};

const isSuccessfulToolCompletion = (item: CodexToolItem): boolean => {
  if (isCommandExecutionItem(item)) {
    const exitCode = item.exit_code ?? undefined;
    return item.status === 'completed' && (exitCode === undefined || exitCode === 0);
  }

  if (isMcpToolCallItem(item) && hasMcpResultError(item)) return false;

  return item.status !== 'cancelled' && item.status !== 'error' && item.status !== 'failed';
};

const truncateCodexCommandOutput = (content: string) => {
  if (!content || content.length <= CODEX_COMMAND_OUTPUT_MAX_LENGTH) {
    return {
      output: content,
      truncated: false,
    };
  }

  let cutoff = CODEX_COMMAND_OUTPUT_MAX_LENGTH;
  const lastCharCode = content.charCodeAt(cutoff - 1);
  if (lastCharCode >= 0xd8_00 && lastCharCode <= 0xdb_ff) {
    cutoff -= 1;
  }

  const omittedCharacters = content.length - cutoff;
  const notice = `\n\n[Output truncated: ${omittedCharacters} characters omitted. Original length: ${content.length} characters]`;

  return {
    omittedCharacters,
    originalLength: content.length,
    output: content.slice(0, cutoff) + notice,
    truncated: true,
  };
};

const getToolResultData = (item: CodexToolItem): ToolResultData => {
  const isSuccess = isSuccessfulToolCompletion(item);
  const output = getToolContent(item, isSuccess);

  if (isCommandExecutionItem(item)) {
    const exitCode = item.exit_code ?? undefined;
    const truncatedOutput = truncateCodexCommandOutput(output);

    return {
      content: truncatedOutput.output,
      isError: !isSuccess,
      pluginState: {
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(isSuccess
          ? {}
          : { error: truncatedOutput.output || `Command failed (${exitCode ?? 'unknown'})` }),
        isBackground: false,
        ...(truncatedOutput.truncated
          ? {
              omittedOutputCharacters: truncatedOutput.omittedCharacters,
              originalOutputLength: truncatedOutput.originalLength,
              outputTruncated: true,
            }
          : {}),
        output: truncatedOutput.output,
        stdout: truncatedOutput.output,
        success: isSuccess,
      },
      toolCallId: item.id,
    };
  }

  const pluginState =
    isSuccess && isTodoListItem(item)
      ? synthesizeTodoListPluginState(item)
      : isSuccess && isFileChangeItem(item)
        ? synthesizeFileChangePluginState(item)
        : isMcpToolCallItem(item)
          ? synthesizeMcpToolPluginState(item)
          : isCollabToolCallItem(item)
            ? synthesizeCollabToolPluginState(item)
            : isWebSearchItem(item)
              ? synthesizeWebSearchPluginState(item)
              : undefined;

  return {
    content: output,
    isError: !isSuccess,
    ...(pluginState ? { pluginState } : {}),
    toolCallId: item.id,
  };
};

const getEventModel = (raw: any): string | undefined => {
  const candidates = [
    raw?.model,
    raw?.session?.model,
    raw?.sessionMeta?.model,
    raw?.session_meta?.model,
    raw?.turn?.model,
    raw?.turn_context?.model,
  ];

  return candidates.find((candidate): candidate is string => typeof candidate === 'string');
};

const getStringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const parseMaybeJsonError = (value: string): string => {
  try {
    const parsed = JSON.parse(value);
    return (
      getStringValue(parsed?.error?.message) ||
      getStringValue(parsed?.message) ||
      getStringValue(parsed?.error) ||
      value
    );
  } catch {
    return value;
  }
};

const getCodexTerminalErrorMessage = (raw: any): string => {
  const rawMessage =
    getStringValue(raw?.message) ||
    getStringValue(raw?.error?.message) ||
    getStringValue(raw?.error) ||
    getStringValue(raw?.result);

  if (rawMessage) return parseMaybeJsonError(rawMessage);

  if (raw?.error && typeof raw.error === 'object') {
    return (
      getStringValue(raw.error.message) ||
      getStringValue(raw.error.type) ||
      JSON.stringify(raw.error)
    );
  }

  return 'Codex execution failed';
};

const getCodexTerminalErrorStderr = (raw: any): string | undefined => {
  const rawMessage =
    getStringValue(raw?.message) ||
    getStringValue(raw?.error?.message) ||
    getStringValue(raw?.error) ||
    getStringValue(raw?.result);

  return (
    rawMessage ||
    (raw?.error && typeof raw.error === 'object' ? JSON.stringify(raw.error) : undefined)
  );
};

const getZonedDateTimeParts = (date: Date, timeZone: string): ZonedDateTimeParts | undefined => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone,
      year: 'numeric',
    }).formatToParts(date);
    const values = new Map(parts.map(({ type, value }) => [type, value]));
    const zonedParts = {
      day: Number(values.get('day')),
      hour: Number(values.get('hour')),
      minute: Number(values.get('minute')),
      month: Number(values.get('month')),
      second: Number(values.get('second')),
      year: Number(values.get('year')),
    };

    if (Object.values(zonedParts).some((value) => !Number.isInteger(value))) return;

    return zonedParts;
  } catch {
    return;
  }
};

const getTimeZoneOffsetMs = (date: Date, timeZone: string): number | undefined => {
  const parts = getZonedDateTimeParts(date, timeZone);
  if (!parts) return;

  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return zonedAsUtc - date.getTime();
};

const matchesZonedWallClock = (
  date: Date,
  timeZone: string,
  expected: ZonedDateTimeParts,
): boolean => {
  const actual = getZonedDateTimeParts(date, timeZone);

  return (
    !!actual &&
    actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute &&
    actual.second === expected.second
  );
};

const zonedWallClockToEpochMs = (
  parts: ZonedDateTimeParts,
  timeZone: string,
): number | undefined => {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const initialOffset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  if (initialOffset === undefined) return;

  let epochMs = utcGuess - initialOffset;
  const adjustedOffset = getTimeZoneOffsetMs(new Date(epochMs), timeZone);
  if (adjustedOffset === undefined) return;

  epochMs = utcGuess - adjustedOffset;
  if (!matchesZonedWallClock(new Date(epochMs), timeZone, parts)) return;

  return epochMs;
};

const addDaysToZonedDate = (
  parts: Pick<ZonedDateTimeParts, 'day' | 'month' | 'year'>,
  days: number,
) => {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));

  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
};

const parseCodexRetryAtInTimeZone = (
  hour: number,
  minute: number,
  timeZone: string,
  now: Date,
): number | undefined => {
  const nowParts = getZonedDateTimeParts(now, timeZone);
  if (!nowParts) return;

  let retryAt = zonedWallClockToEpochMs(
    {
      day: nowParts.day,
      hour,
      minute,
      month: nowParts.month,
      second: 0,
      year: nowParts.year,
    },
    timeZone,
  );
  if (retryAt === undefined) return;

  if (retryAt <= now.getTime()) {
    const nextDate = addDaysToZonedDate(nowParts, 1);
    retryAt = zonedWallClockToEpochMs(
      {
        ...nextDate,
        hour,
        minute,
        second: 0,
      },
      timeZone,
    );
  }

  return retryAt === undefined ? undefined : Math.floor(retryAt / 1000);
};

const parseCodexRetryAt = (message: string, now = new Date()): number | undefined => {
  const match = CODEX_RETRY_AT_PATTERN.exec(message);
  if (!match) return;

  const [, rawHour, rawMinute, rawAdjacentMeridiem, rawSpacedMeridiem, rawTimeZone] = match;
  const hour = Number(rawHour);
  const minute = rawMinute ? Number(rawMinute) : 0;
  const meridiem = (rawAdjacentMeridiem || rawSpacedMeridiem)?.toUpperCase();
  const timeZone = rawTimeZone?.trim();

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return;
  }

  let normalizedHour = hour;
  if (meridiem) {
    if (hour < 1 || hour > 12) return;
    normalizedHour = (hour % 12) + (meridiem === 'PM' ? 12 : 0);
  } else if (hour < 0 || hour > 23) {
    return;
  }

  if (timeZone) {
    return parseCodexRetryAtInTimeZone(normalizedHour, minute, timeZone, now);
  }

  const resetAt = new Date(now);
  resetAt.setHours(normalizedHour, minute, 0, 0);
  if (resetAt.getTime() <= now.getTime()) {
    resetAt.setDate(resetAt.getDate() + 1);
  }

  return Math.floor(resetAt.getTime() / 1000);
};

const getCodexRateLimitInfo = (message: string): HeterogeneousRateLimitInfo | undefined => {
  if (!CODEX_USER_RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))) return;

  const resetsAt = parseCodexRetryAt(message);

  return {
    ...(resetsAt ? { resetsAt } : {}),
    status: 'rejected',
  };
};

export class CodexAdapter implements AgentEventAdapter {
  private currentAgentMessageItemId?: string;
  private currentModel?: string;
  private lastCumulativeUsage?: UsageData;
  sessionId?: string;

  private hasTextInCurrentStep = false;
  private hasToolActivitySinceAgentMessage = false;
  private pendingToolCalls = new Set<string>();
  private pendingToolCallStepIndex = new Map<string, number>();
  private stepToolCalls: ToolCallPayload[] = [];
  private stepToolCallIds = new Set<string>();
  private started = false;
  private stepIndex = 0;
  private terminalEndEmitted = false;
  private terminalErrorEmitted = false;

  constructor(options: { initialCumulativeUsage?: UsageData | undefined } = {}) {
    this.lastCumulativeUsage = options.initialCumulativeUsage;
  }

  adapt(raw: any): HeterogeneousAgentEvent[] {
    if (!raw || typeof raw !== 'object') return [];

    switch (raw.type) {
      case 'thread.started': {
        this.sessionId = raw.thread_id;
        return [];
      }
      case 'turn.started': {
        return this.handleTurnStarted();
      }
      case 'session.configured':
      case 'session_configured': {
        return this.handleSessionConfigured(raw);
      }
      case 'turn.completed': {
        return this.handleTurnCompleted(raw);
      }
      case 'error':
      case 'turn.failed': {
        return this.handleTerminalError(raw);
      }
      case 'item.started': {
        return this.handleItemStarted(raw.item);
      }
      case 'item.completed': {
        return this.handleItemCompleted(raw.item);
      }
      default: {
        return [];
      }
    }
  }

  flush(): HeterogeneousAgentEvent[] {
    return this.drainPendingToolEndEvents();
  }

  private handleTurnCompleted(raw: any): HeterogeneousAgentEvent[] {
    if (this.terminalEndEmitted || this.terminalErrorEmitted) return [];

    this.terminalEndEmitted = true;
    const model = getEventModel(raw) || this.currentModel;
    if (model) this.currentModel = model;

    const cumulativeUsage = toCodexUsageData(raw.usage);
    const usage = toTurnUsageFromCumulative(cumulativeUsage, this.lastCumulativeUsage);
    if (cumulativeUsage) this.lastCumulativeUsage = cumulativeUsage;
    const events = this.drainPendingToolEndEvents();

    if (usage || model) {
      const data: StepCompleteData = {
        ...(model ? { model } : {}),
        phase: 'turn_metadata',
        provider: CODEX_IDENTIFIER,
        ...(usage ? { usage } : {}),
      };

      events.push(this.makeEvent('step_complete', data));
    }

    if (this.started) {
      events.push(this.makeEvent('stream_end', {}));
      events.push(this.makeEvent('visible_output_end', {}));
    }
    events.push(this.makeEvent('agent_runtime_end', {}));

    return events;
  }

  private handleTerminalError(raw: any): HeterogeneousAgentEvent[] {
    if (this.terminalErrorEmitted || this.terminalEndEmitted) return [];

    this.terminalErrorEmitted = true;
    const message = getCodexTerminalErrorMessage(raw);
    const stderr = getCodexTerminalErrorStderr(raw);
    const rateLimitInfo = getCodexRateLimitInfo(message);
    const data: HeterogeneousTerminalErrorData = {
      agentType: CODEX_IDENTIFIER,
      clearEchoedContent: true,
      ...(rateLimitInfo
        ? {
            code: 'rate_limit',
            docsUrl: CODEX_USAGE_SETTINGS_URL,
            rateLimitInfo,
          }
        : {}),
      message,
      stderr,
    };

    const events: HeterogeneousAgentEvent[] = this.started
      ? [this.makeEvent('stream_end', {}), this.makeEvent('visible_output_end', {})]
      : [];
    events.push(this.makeEvent('error', data));

    return events;
  }

  private handleSessionConfigured(raw: any): HeterogeneousAgentEvent[] {
    if (raw.initialCumulativeUsage) {
      this.lastCumulativeUsage = raw.initialCumulativeUsage;
    }

    const model = getEventModel(raw);
    if (!model || model === this.currentModel) return [];

    this.currentModel = model;
    return [
      this.makeEvent('step_complete', {
        model,
        phase: 'turn_metadata',
        provider: CODEX_IDENTIFIER,
      } satisfies StepCompleteData),
    ];
  }

  private handleTurnStarted(): HeterogeneousAgentEvent[] {
    this.currentAgentMessageItemId = undefined;
    this.hasTextInCurrentStep = false;
    this.hasToolActivitySinceAgentMessage = false;
    this.resetStepToolCalls();

    if (!this.started) {
      this.started = true;
      return [this.makeEvent('stream_start', this.getStreamStartData())];
    }

    this.stepIndex += 1;
    return [
      this.makeEvent('stream_end', {}),
      this.makeEvent('stream_start', this.getStreamStartData({ newStep: true })),
    ];
  }

  private handleItemStarted(item: any): HeterogeneousAgentEvent[] {
    if (!item?.id || !item?.type || item.type === 'agent_message') return [];

    this.hasToolActivitySinceAgentMessage = true;

    const tool = toToolPayload(item);
    this.pendingToolCalls.add(tool.id);
    this.pendingToolCallStepIndex.set(tool.id, this.stepIndex);

    return this.emitToolChunk(tool);
  }

  private handleItemCompleted(item: any): HeterogeneousAgentEvent[] {
    if (!item?.type) return [];

    if (item.type === 'agent_message') {
      if (!item.text) return [];

      const events: HeterogeneousAgentEvent[] = [];
      const shouldStartNewStep =
        this.hasToolActivitySinceAgentMessage &&
        !!item.id &&
        item.id !== this.currentAgentMessageItemId;

      if (shouldStartNewStep) {
        this.stepIndex += 1;
        this.resetStepToolCalls();
        this.hasTextInCurrentStep = false;
        events.push(this.makeEvent('stream_end', {}));
        events.push(this.makeEvent('stream_start', this.getStreamStartData({ newStep: true })));
      }

      const content =
        this.hasTextInCurrentStep && item.id !== this.currentAgentMessageItemId
          ? `\n\n${item.text}`
          : item.text;

      this.currentAgentMessageItemId = item.id;
      this.hasTextInCurrentStep = true;
      this.hasToolActivitySinceAgentMessage = false;
      events.push(
        this.makeEvent('stream_chunk', {
          chunkType: 'text',
          content,
        }),
      );

      return events;
    }

    if (!item.id) return [];

    const events: HeterogeneousAgentEvent[] = [];
    const pendingStepIndex = this.pendingToolCallStepIndex.get(item.id);
    const belongsToCurrentStep =
      pendingStepIndex === undefined || pendingStepIndex === this.stepIndex;

    if (!this.pendingToolCalls.has(item.id)) {
      const tool = toToolPayload(item);
      this.pendingToolCallStepIndex.set(tool.id, this.stepIndex);
      events.push(...this.emitToolChunk(tool));
    }

    this.pendingToolCalls.delete(item.id);
    this.pendingToolCallStepIndex.delete(item.id);
    if (belongsToCurrentStep) this.hasToolActivitySinceAgentMessage = true;
    events.push(this.makeEvent('tool_result', getToolResultData(item as CodexToolItem)));
    events.push(
      this.makeEvent('tool_end', {
        isSuccess: isSuccessfulToolCompletion(item as CodexToolItem),
        toolCallId: item.id,
      }),
    );

    return events;
  }

  private drainPendingToolEndEvents(): HeterogeneousAgentEvent[] {
    const events = [...this.pendingToolCalls].map((toolCallId) =>
      this.makeEvent('tool_end', {
        isSuccess: false,
        toolCallId,
      }),
    );

    this.pendingToolCalls.clear();
    this.pendingToolCallStepIndex.clear();
    return events;
  }

  private emitToolChunk(tool: ToolCallPayload): HeterogeneousAgentEvent[] {
    if (!this.stepToolCallIds.has(tool.id)) {
      this.stepToolCallIds.add(tool.id);
      this.stepToolCalls.push(tool);
    }

    return [
      this.makeEvent('stream_chunk', {
        chunkType: 'tools_calling',
        toolsCalling: [...this.stepToolCalls],
      }),
      this.makeEvent('tool_start', {
        toolCallId: tool.id,
      }),
    ];
  }

  private resetStepToolCalls(): void {
    this.stepToolCalls = [];
    this.stepToolCallIds.clear();
  }

  private getStreamStartData(extra: Record<string, unknown> = {}): StreamStartData {
    return {
      ...(this.currentModel ? { model: this.currentModel } : {}),
      provider: CODEX_IDENTIFIER,
      ...extra,
    };
  }

  private makeEvent(type: HeterogeneousAgentEvent['type'], data: any): HeterogeneousAgentEvent {
    return {
      data,
      stepIndex: this.stepIndex,
      timestamp: Date.now(),
      type,
    };
  }
}

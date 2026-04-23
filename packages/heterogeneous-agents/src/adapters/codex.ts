import type {
  AgentCLIPreset,
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  StepCompleteData,
  ToolCallPayload,
  ToolResultData,
  UsageData,
} from '../types';

const CODEX_IDENTIFIER = 'codex';
const CODEX_COLLAB_TOOL_CALL_API = 'collab_tool_call';
const CODEX_COMMAND_API = 'command_execution';
const CODEX_FILE_CHANGE_API = 'file_change';
const CODEX_TODO_LIST_API = 'todo_list';

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
  kind?: string;
  linesAdded?: number;
  linesDeleted?: number;
  path?: string;
}

interface CodexFileChangeItem extends CodexBaseItem {
  changes?: CodexFileChangeEntry[];
  linesAdded?: number;
  linesDeleted?: number;
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
  | CodexTodoListItem;

const isCommandExecutionItem = (item: CodexToolItem): item is CodexCommandExecutionItem =>
  item.type === CODEX_COMMAND_API;

const isCollabToolCallItem = (item: CodexToolItem): item is CodexCollabToolCallItem =>
  item.type === CODEX_COLLAB_TOOL_CALL_API;

const isFileChangeItem = (item: CodexToolItem): item is CodexFileChangeItem =>
  item.type === CODEX_FILE_CHANGE_API;

const isTodoListItem = (item: CodexToolItem): item is CodexTodoListItem =>
  item.type === CODEX_TODO_LIST_API;

const toUsageData = (
  raw:
    | {
        cached_input_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
      }
    | null
    | undefined,
): UsageData | undefined => {
  if (!raw) return undefined;

  const inputCacheMissTokens = raw.input_tokens || 0;
  const inputCachedTokens = raw.cached_input_tokens || 0;
  const totalInputTokens = inputCacheMissTokens + inputCachedTokens;
  const totalOutputTokens = raw.output_tokens || 0;

  if (totalInputTokens + totalOutputTokens === 0) return undefined;

  return {
    inputCachedTokens: inputCachedTokens || undefined,
    inputCacheMissTokens,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
};

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
    linesAdded: item.linesAdded ?? 0,
    linesDeleted: item.linesDeleted ?? 0,
  };
};

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  count === 1 ? singular : plural;

const toToolPayload = (item: CodexToolItem): ToolCallPayload => ({
  apiName: item.type || CODEX_COMMAND_API,
  arguments: JSON.stringify(isCommandExecutionItem(item) ? { command: item.command || '' } : item),
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

const summarizeFallbackTool = (item: CodexToolItem): string => {
  return `Completed ${item.type}.`;
};

const getFailureVerb = (item: CodexToolItem): 'cancelled' | 'failed' =>
  item.status === 'cancelled' ? 'cancelled' : 'failed';

const getToolFailureContent = (item: CodexToolItem): string => {
  if (isTodoListItem(item)) return `Todo list update ${getFailureVerb(item)}.`;
  if (isFileChangeItem(item)) return `File changes ${getFailureVerb(item)}.`;
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
  if (isCollabToolCallItem(item)) return summarizeCollabToolCall(item);

  return summarizeFallbackTool(item);
};

const isSuccessfulToolCompletion = (item: CodexToolItem): boolean => {
  if (isCommandExecutionItem(item)) {
    const exitCode = item.exit_code ?? undefined;
    return item.status === 'completed' && (exitCode === undefined || exitCode === 0);
  }

  return item.status !== 'cancelled' && item.status !== 'error' && item.status !== 'failed';
};

const getToolResultData = (item: CodexToolItem): ToolResultData => {
  const isSuccess = isSuccessfulToolCompletion(item);
  const output = getToolContent(item, isSuccess);

  if (isCommandExecutionItem(item)) {
    const exitCode = item.exit_code ?? undefined;

    return {
      content: output,
      isError: !isSuccess,
      pluginState: {
        ...(exitCode !== undefined ? { exitCode } : {}),
        ...(isSuccess ? {} : { error: output || `Command failed (${exitCode ?? 'unknown'})` }),
        isBackground: false,
        output,
        stdout: output,
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

export const codexPreset: AgentCLIPreset = {
  baseArgs: ['exec', '--json', '--skip-git-repo-check', '--full-auto'],
  promptMode: 'stdin',
  resumeArgs: (sessionId) => ['exec', 'resume', '--json', '--skip-git-repo-check', sessionId],
};

export class CodexAdapter implements AgentEventAdapter {
  private currentAgentMessageItemId?: string;
  private currentModel?: string;
  sessionId?: string;

  private hasStepActivity = false;
  private pendingToolCalls = new Set<string>();
  private stepToolCalls: ToolCallPayload[] = [];
  private stepToolCallIds = new Set<string>();
  private started = false;
  private stepIndex = 0;

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
    const events = [...this.pendingToolCalls].map((toolCallId) =>
      this.makeEvent('tool_end', {
        isSuccess: false,
        toolCallId,
      }),
    );

    this.pendingToolCalls.clear();
    return events;
  }

  private handleTurnCompleted(raw: any): HeterogeneousAgentEvent[] {
    const model = getEventModel(raw) || this.currentModel;
    if (model) this.currentModel = model;

    const usage = toUsageData(raw.usage);
    if (!usage && !model) return [];

    const data: StepCompleteData = {
      ...(model ? { model } : {}),
      phase: 'turn_metadata',
      provider: CODEX_IDENTIFIER,
      ...(usage ? { usage } : {}),
    };

    return [this.makeEvent('step_complete', data)];
  }

  private handleSessionConfigured(raw: any): HeterogeneousAgentEvent[] {
    const model = getEventModel(raw);
    if (model) this.currentModel = model;

    return [];
  }

  private handleTurnStarted(): HeterogeneousAgentEvent[] {
    this.currentAgentMessageItemId = undefined;
    this.hasStepActivity = false;
    this.resetStepToolCalls();

    if (!this.started) {
      this.started = true;
      return [this.makeEvent('stream_start', { provider: CODEX_IDENTIFIER })];
    }

    this.stepIndex += 1;
    return [
      this.makeEvent('stream_end', {}),
      this.makeEvent('stream_start', { newStep: true, provider: CODEX_IDENTIFIER }),
    ];
  }

  private handleItemStarted(item: any): HeterogeneousAgentEvent[] {
    if (!item?.id || !item?.type || item.type === 'agent_message') return [];

    this.hasStepActivity = true;

    const tool = toToolPayload(item);
    this.pendingToolCalls.add(tool.id);

    return this.emitToolChunk(tool);
  }

  private handleItemCompleted(item: any): HeterogeneousAgentEvent[] {
    if (!item?.type) return [];

    if (item.type === 'agent_message') {
      if (!item.text) return [];

      const events: HeterogeneousAgentEvent[] = [];
      const shouldStartNewStep =
        this.hasStepActivity && !!item.id && item.id !== this.currentAgentMessageItemId;

      if (shouldStartNewStep) {
        this.stepIndex += 1;
        this.resetStepToolCalls();
        events.push(this.makeEvent('stream_end', {}));
        events.push(this.makeEvent('stream_start', { newStep: true, provider: CODEX_IDENTIFIER }));
      }

      this.currentAgentMessageItemId = item.id;
      this.hasStepActivity = true;
      events.push(
        this.makeEvent('stream_chunk', {
          chunkType: 'text',
          content: item.text,
        }),
      );

      return events;
    }

    if (!item.id) return [];

    const events: HeterogeneousAgentEvent[] = [];

    if (!this.pendingToolCalls.has(item.id)) {
      const tool = toToolPayload(item);
      events.push(...this.emitToolChunk(tool));
    }

    this.pendingToolCalls.delete(item.id);
    this.hasStepActivity = true;
    events.push(this.makeEvent('tool_result', getToolResultData(item as CodexToolItem)));
    events.push(
      this.makeEvent('tool_end', {
        isSuccess: isSuccessfulToolCompletion(item as CodexToolItem),
        toolCallId: item.id,
      }),
    );

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

  private makeEvent(type: HeterogeneousAgentEvent['type'], data: any): HeterogeneousAgentEvent {
    return {
      data,
      stepIndex: this.stepIndex,
      timestamp: Date.now(),
      type,
    };
  }
}

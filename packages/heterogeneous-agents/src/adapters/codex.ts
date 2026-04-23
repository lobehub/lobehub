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
const CODEX_COMMAND_API = 'command_execution';

interface CodexCommandExecutionItem {
  aggregated_output?: string;
  command?: string;
  exit_code?: number | null;
  id: string;
  status?: string;
  type: string;
}

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

const toToolPayload = (item: CodexCommandExecutionItem): ToolCallPayload => ({
  apiName: item.type || CODEX_COMMAND_API,
  arguments: JSON.stringify(
    item.type === CODEX_COMMAND_API ? { command: item.command || '' } : item,
  ),
  id: item.id,
  identifier: CODEX_IDENTIFIER,
  type: 'default',
});

const getToolContent = (item: CodexCommandExecutionItem): string => {
  if (typeof item.aggregated_output === 'string') return item.aggregated_output;
  return '';
};

const getToolResultData = (item: CodexCommandExecutionItem): ToolResultData => {
  const exitCode = item.exit_code ?? undefined;
  const output = getToolContent(item);
  const isSuccess = item.status === 'completed' && (exitCode === undefined || exitCode === 0);

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
    events.push(this.makeEvent('tool_result', getToolResultData(item)));
    events.push(
      this.makeEvent('tool_end', {
        isSuccess:
          item.status === 'completed' &&
          (item.exit_code === null || item.exit_code === undefined || item.exit_code === 0),
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

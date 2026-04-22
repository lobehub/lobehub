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

export const codexPreset: AgentCLIPreset = {
  baseArgs: ['exec', '--json', '--skip-git-repo-check', '--full-auto'],
  promptMode: 'stdin',
  resumeArgs: (sessionId) => ['exec', 'resume', '--json', '--skip-git-repo-check', sessionId],
};

export class CodexAdapter implements AgentEventAdapter {
  sessionId?: string;

  private pendingToolCalls = new Set<string>();
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
    const usage = toUsageData(raw.usage);
    if (!usage) return [];

    const data: StepCompleteData = {
      phase: 'turn_metadata',
      provider: CODEX_IDENTIFIER,
      usage,
    };

    return [this.makeEvent('step_complete', data)];
  }

  private handleTurnStarted(): HeterogeneousAgentEvent[] {
    if (this.started) {
      this.stepIndex += 1;
    } else {
      this.started = true;
    }

    return [this.makeEvent('stream_start', { provider: CODEX_IDENTIFIER })];
  }

  private handleItemStarted(item: any): HeterogeneousAgentEvent[] {
    if (!item?.id || !item?.type || item.type === 'agent_message') return [];

    const tool = toToolPayload(item);
    this.pendingToolCalls.add(tool.id);

    return [
      this.makeEvent('stream_chunk', {
        chunkType: 'tools_calling',
        toolsCalling: [tool],
      }),
      this.makeEvent('tool_start', {
        toolCallId: tool.id,
      }),
    ];
  }

  private handleItemCompleted(item: any): HeterogeneousAgentEvent[] {
    if (!item?.type) return [];

    if (item.type === 'agent_message') {
      if (!item.text) return [];
      return [
        this.makeEvent('stream_chunk', {
          chunkType: 'text',
          content: item.text,
        }),
      ];
    }

    if (!item.id) return [];

    const events: HeterogeneousAgentEvent[] = [];

    if (!this.pendingToolCalls.has(item.id)) {
      const tool = toToolPayload(item);
      events.push(
        this.makeEvent('stream_chunk', {
          chunkType: 'tools_calling',
          toolsCalling: [tool],
        }),
      );
      events.push(
        this.makeEvent('tool_start', {
          toolCallId: tool.id,
        }),
      );
    }

    this.pendingToolCalls.delete(item.id);
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

  private makeEvent(type: HeterogeneousAgentEvent['type'], data: any): HeterogeneousAgentEvent {
    return {
      data,
      stepIndex: this.stepIndex,
      timestamp: Date.now(),
      type,
    };
  }
}

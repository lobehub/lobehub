import type {
  AssistantContentBlock,
  ChatToolPayload,
  MessageSignal,
  MessageTaskStatus,
} from '@lobechat/types';

/**
 * What kind of background work ended, in the reader's terms rather than the
 * tool that started it: a resumed subagent is still a subagent, even though
 * the call that woke it was `SendMessage`.
 */
export type TaskCompletionKind = 'command' | 'subagent' | 'tool';

export interface TaskCompletionSource {
  kind: TaskCompletionKind;
  /** How the task ended; undefined on messages persisted before it was recorded. */
  status?: MessageTaskStatus;
  /** Claude Code's raw one-line summary, e.g. `Background command "Run tests" failed with exit code 1`. */
  summary?: string;
  /** The task's title, e.g. a subagent's `description` such as `Acceptance runner`. */
  title?: string;
  /** API name of the tool that started or resumed the task; labels `tool` kinds. */
  toolName: string;
}

/** Anything that carries tool calls: reply blocks or raw messages. */
interface ToolCallHost {
  tools?: Pick<ChatToolPayload, 'apiName' | 'arguments' | 'id'>[] | null;
}

/** `Task` is the pre-rename name of `Agent`; `SendMessage` resumes a subagent. */
const SUBAGENT_TOOLS = new Set(['Agent', 'SendMessage', 'Task']);
const COMMAND_TOOLS = new Set(['Bash']);

const toKind = (toolName: string): TaskCompletionKind => {
  if (SUBAGENT_TOOLS.has(toolName)) return 'subagent';
  if (COMMAND_TOOLS.has(toolName)) return 'command';
  return 'tool';
};

const readDescription = (args?: string): string | undefined => {
  if (!args) return;
  try {
    const description = JSON.parse(args)?.description;
    return typeof description === 'string' && description.trim() ? description.trim() : undefined;
  } catch {
    return;
  }
};

/**
 * The quoted task title in Claude Code's summary: `Agent "Review" finished`,
 * `Background command "Run tests" failed with exit code 1`. Greedy, so a
 * title that itself contains quotes survives.
 */
const readSummaryTitle = (summary?: string): string | undefined => {
  const title = summary?.match(/"(.+)"/)?.[1]?.trim();
  return title || undefined;
};

const findToolCall = (hosts: ToolCallHost[], toolCallId: string) => {
  for (const host of hosts) {
    const call = host.tools?.find((tool) => tool.id === toolCallId);
    if (call) return call;
  }
};

/**
 * The background task (a subagent, a background command, a Monitor…) whose
 * completion woke a task-completion turn, so the notice can say which task
 * ended and how. Undefined for any other block.
 */
export const resolveTaskCompletionSource = (
  block: Pick<AssistantContentBlock, 'metadata'>,
  hosts: ToolCallHost[],
): TaskCompletionSource | undefined => {
  const signal = block.metadata?.signal as MessageSignal | undefined;
  if (signal?.type !== 'task-completion') return;

  const sourceCall = findToolCall(hosts, signal.sourceToolCallId);
  const toolName = sourceCall?.apiName ?? signal.sourceToolName;

  return {
    kind: toKind(toolName),
    status: signal.taskStatus,
    summary: signal.taskSummary,
    title: readDescription(sourceCall?.arguments) ?? readSummaryTitle(signal.taskSummary),
    toolName,
  };
};

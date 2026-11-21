import { isRecord, pickString, toRecord, type UnknownRecord } from '@lobechat/utils/object';

import { classifyCliMessageError } from '../errors/classifyCliMessageError';
import type {
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  ToolCallPayload,
  UsageData,
} from '../types';

const IDENTIFIER = 'antigravity';

interface PendingTool {
  payload: ToolCallPayload;
  started?: boolean;
  stepIndex: number;
}

const tokenCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const extractUsage = (raw: unknown): UsageData | undefined => {
  if (!isRecord(raw)) return;
  const inputCacheMissTokens = tokenCount(raw.input_tokens);
  const inputCachedTokens = tokenCount(raw.cache_read_tokens);
  const totalOutputTokens = tokenCount(raw.output_tokens);
  const outputReasoningTokens = Math.min(tokenCount(raw.thinking_tokens), totalOutputTokens);
  // agy's input_tokens/total_tokens exclude cache reads (see the second turn
  // in its headless stream-input example). Our totals include cached input.
  const totalInputTokens = inputCacheMissTokens + inputCachedTokens;
  return {
    inputCachedTokens,
    inputCacheMissTokens,
    outputReasoningTokens,
    outputTextTokens: totalOutputTokens - outputReasoningTokens,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
};

const stringifyOutput = (value: unknown): string =>
  typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);

export interface AntigravityAdapterOptions {
  /**
   * When stdin stays open across turns (liveInput / steer), keep accepting
   * subsequent turns after a `SUCCESS` `result` instead of closing the adapter
   * on the first turn's result.
   */
  runtimeEndStrategy?: 'on-result' | 'on-transport-close';
  /**
   * Shift the next steered message UUID when `agy` starts a subsequent
   * `user_input` step, so the adapter can emit `step_complete { phase: 'user_message', uuid }`.
   */
  takeNextSteerUuid?: () => string | undefined;
}

/**
 * Native agy NDJSON protocol, not the Gemini/Claude stream-json protocol.
 * https://antigravity.google/docs/cli/headless/
 * Supports both one-shot turns and multi-turn liveInput steering while stdin remains open.
 */
export class AntigravityAdapter implements AgentEventAdapter {
  sessionId?: string;

  private completedSteps = new Set<number>();
  private flushed = false;
  private hasResponseText = false;
  private latestTurnCompleted = false;
  private model?: string;
  private pendingTools = new Map<number, PendingTool>();
  private resultReceived = false;
  private completionValidated = false;
  private responseStep?: number;
  private readonly runtimeEndStrategy: 'on-result' | 'on-transport-close';
  private seenInitialUserInput = false;
  private seenUserInputSteps = new Set<number>();
  private stepIndex = 0;
  private stepTools: ToolCallPayload[] = [];
  private streamOpen = false;
  private readonly takeNextSteerUuid?: () => string | undefined;
  private toolSinceResponse = false;
  private usageByStep = new Map<number, UsageData>();

  constructor(options: AntigravityAdapterOptions = {}) {
    this.runtimeEndStrategy = options.runtimeEndStrategy ?? 'on-result';
    this.takeNextSteerUuid = options.takeNextSteerUuid;
  }

  adapt(raw: unknown): HeterogeneousAgentEvent[] {
    if (this.flushed || this.resultReceived || !isRecord(raw)) return [];
    if (raw.event === 'init') {
      this.latestTurnCompleted = false;
      this.sessionId = pickString(raw.conversation_id);
      this.model = pickString(toRecord(raw.init)?.model);
      return this.openStream();
    }
    if (raw.event === 'result' && isRecord(raw.result)) return this.handleResult(raw.result);
    if (raw.event !== 'step_update' || !isRecord(raw.step_update)) return [];

    const step = raw.step_update;
    const index = step.step_index;
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) return [];
    // Child conversations must never leak into the parent's assistant bubble.
    const conversationId = pickString(step.conversation_id);
    if (this.sessionId && conversationId && conversationId !== this.sessionId) return [];
    this.sessionId ??= conversationId;
    if (this.completedSteps.has(index)) return [];
    this.latestTurnCompleted = false;

    const events: HeterogeneousAgentEvent[] = [];
    if (step.step_type === 'user_input') {
      if (!this.seenUserInputSteps.has(index)) {
        this.seenUserInputSteps.add(index);
        if (!this.seenInitialUserInput) {
          this.seenInitialUserInput = true;
        } else {
          const uuid = this.takeNextSteerUuid?.();
          if (uuid) {
            events.push(...this.closeStream());
            events.push(this.event('step_complete', { phase: 'user_message', uuid }));
          }
        }
      }
    } else if (step.step_type === 'agent_response') {
      if (
        this.toolSinceResponse ||
        (this.responseStep !== undefined && this.responseStep !== index)
      ) {
        events.push(...this.closeStream());
        this.stepIndex += 1;
        this.stepTools = [];
        this.hasResponseText = false;
      }
      events.push(...this.openStream());
      this.toolSinceResponse = false;
      this.responseStep = index;
      if (typeof step.text_delta === 'string' && step.text_delta) {
        this.hasResponseText = true;
        events.push(this.event('stream_chunk', { chunkType: 'text', content: step.text_delta }));
      }
    } else if (step.step_type === 'tool' || isRecord(step.subagent_info)) {
      events.push(...this.handleTool(index, step));
    }

    if (step.state === 'DONE') {
      this.completedSteps.add(index);
      const usage = extractUsage(step.usage);
      if (usage) this.usageByStep.set(index, usage);
    }
    return events;
  }

  flush(): HeterogeneousAgentEvent[] {
    if (this.flushed) return [];
    this.flushed = true;
    return [
      ...this.settlePendingTools('Antigravity ended before this tool returned a result.'),
      ...this.closeStream(),
    ];
  }

  validateCompletion(): HeterogeneousAgentEvent[] {
    if (this.resultReceived || this.latestTurnCompleted || this.completionValidated) return [];
    this.completionValidated = true;
    return [
      this.event('error', {
        agentType: IDENTIFIER,
        code: 'incomplete_response',
        message: 'Antigravity exited without a final result. Update agy and retry.',
      }),
    ];
  }

  private openStream(): HeterogeneousAgentEvent[] {
    if (this.streamOpen) return [];
    this.streamOpen = true;
    return [
      this.event('stream_start', {
        model: this.model,
        newStep: this.stepIndex > 0,
        provider: IDENTIFIER,
        sessionId: this.sessionId,
      }),
    ];
  }

  private closeStream(): HeterogeneousAgentEvent[] {
    const events: HeterogeneousAgentEvent[] = [];
    if (this.usageByStep.size) {
      const usage = [...this.usageByStep.values()].reduce((total, next) => ({
        inputCachedTokens: (total.inputCachedTokens ?? 0) + (next.inputCachedTokens ?? 0),
        inputCacheMissTokens: total.inputCacheMissTokens + next.inputCacheMissTokens,
        outputReasoningTokens:
          (total.outputReasoningTokens ?? 0) + (next.outputReasoningTokens ?? 0),
        outputTextTokens: (total.outputTextTokens ?? 0) + (next.outputTextTokens ?? 0),
        totalInputTokens: total.totalInputTokens + next.totalInputTokens,
        totalOutputTokens: total.totalOutputTokens + next.totalOutputTokens,
        totalTokens: total.totalTokens + next.totalTokens,
      }));
      events.push(
        this.event('step_complete', {
          model: this.model,
          phase: 'turn_metadata',
          provider: IDENTIFIER,
          usage,
        }),
      );
      this.usageByStep.clear();
    }
    if (this.streamOpen) {
      events.push(this.event('stream_end', {}));
      this.streamOpen = false;
    }
    return events;
  }

  private handleTool(index: number, step: UnknownRecord): HeterogeneousAgentEvent[] {
    const info = toRecord(step.tool_info);
    const subagents = toRecord(step.subagent_info);
    const name = pickString(info?.name) ?? pickString(step.tool_name);
    if (!name && !subagents) return [];
    const events = this.openStream();
    this.toolSinceResponse = true;
    let pending = this.pendingTools.get(index);
    const args = JSON.stringify(info?.parameters ?? subagents ?? {});
    if (!pending) {
      const payload: ToolCallPayload = {
        apiName: name ?? 'subagents',
        arguments: args,
        id: `agy_${this.sessionId ?? 'session'}_${index}`,
        identifier: IDENTIFIER,
        type: 'default',
      };
      pending = { payload, stepIndex: this.stepIndex };
      this.pendingTools.set(index, pending);
    } else if (info?.parameters !== undefined) {
      pending.payload.arguments = args;
    }
    // Persistence snapshots tools_calling, while trace recorders snapshot tool_start.
    // Neither may publish a name-only ACTIVE update with placeholder arguments.
    if (info?.parameters !== undefined || step.state === 'DONE')
      events.push(...this.startTool(pending));
    if (step.state === 'DONE') {
      const error = toRecord(info?.error);
      const output = stringifyOutput(info?.output ?? subagents);
      const errorText = pickString(error?.message) ?? stringifyOutput(info?.error);
      const content = [output, errorText].filter(Boolean).join('\n');
      events.push(...this.toolResult(pending, content, info?.error != null));
      this.pendingTools.delete(index);
    }
    return events;
  }

  private startTool(tool: PendingTool): HeterogeneousAgentEvent[] {
    if (tool.started) return [];
    tool.started = true;
    this.stepTools.push(tool.payload);
    return [
      this.event(
        'stream_chunk',
        {
          chunkType: 'tools_calling',
          toolsCalling: this.stepTools.map((payload) => ({ ...payload })),
        },
        tool.stepIndex,
      ),
      this.event(
        'tool_start',
        { toolCalling: { ...tool.payload }, toolCallId: tool.payload.id },
        tool.stepIndex,
      ),
    ];
  }

  private toolResult(
    tool: PendingTool,
    content: string,
    isError: boolean,
  ): HeterogeneousAgentEvent[] {
    return [
      ...this.startTool(tool),
      this.event('tool_result', { content, isError, toolCallId: tool.payload.id }, tool.stepIndex),
      this.event(
        'tool_end',
        {
          isSuccess: !isError,
          payload: { toolCalling: tool.payload },
          result: { content, success: !isError },
          toolCallId: tool.payload.id,
        },
        tool.stepIndex,
      ),
    ];
  }

  private settlePendingTools(message: string): HeterogeneousAgentEvent[] {
    const events = [...this.pendingTools.values()].flatMap((tool) =>
      this.toolResult(tool, message, true),
    );
    this.pendingTools.clear();
    return events;
  }

  private handleResult(result: UnknownRecord): HeterogeneousAgentEvent[] {
    const keepOpenForMoreTurns =
      this.runtimeEndStrategy === 'on-transport-close' && result.status === 'SUCCESS';
    if (!keepOpenForMoreTurns) this.resultReceived = true;
    this.latestTurnCompleted = true;
    this.sessionId ??= pickString(result.conversation_id);
    const hasPendingTools = this.pendingTools.size > 0;
    // Materialize unfinished tools in their owning turn before a fallback response opens a new one.
    const events = this.settlePendingTools('Antigravity ended before this tool returned a result.');
    if (result.status === 'SUCCESS') {
      // result.response repeats the streamed answer. Use it only when no final
      // response was streamed, never as another delta after agent_response.
      if (
        (!this.hasResponseText || this.toolSinceResponse) &&
        typeof result.response === 'string' &&
        result.response
      ) {
        if (this.toolSinceResponse) {
          events.push(...this.closeStream());
          this.stepIndex += 1;
        }
        events.push(
          ...this.openStream(),
          this.event('stream_chunk', { chunkType: 'text', content: result.response }),
        );
      }
      if (hasPendingTools) {
        events.push(
          this.event('error', {
            agentType: IDENTIFIER,
            code: 'incomplete_tool_result',
            message: 'Antigravity completed without returning all tool results.',
          }),
        );
      }
    } else {
      const detail =
        pickString(result.error) ||
        `Antigravity ended with status ${String(result.status ?? 'unknown')}.`;
      events.push(
        this.event(
          'error',
          classifyCliMessageError({ agentType: IDENTIFIER, detail }) ?? {
            agentType: IDENTIFIER,
            code: 'antigravity_run_error',
            message: detail,
          },
        ),
      );
    }
    events.push(...this.closeStream());
    if (keepOpenForMoreTurns) {
      this.hasResponseText = false;
      this.responseStep = undefined;
      this.toolSinceResponse = false;
      this.stepTools = [];
      this.stepIndex += 1;
    }
    // Result counters are cumulative across a resumed conversation, so they are
    // not emitted as `result_usage`: trace recorders treat that phase as the
    // run total. Step_update usage (turn_metadata) is the only per-run source.
    return events;
  }

  private event(
    type: HeterogeneousAgentEvent['type'],
    data: unknown,
    stepIndex = this.stepIndex,
  ): HeterogeneousAgentEvent {
    return { data, stepIndex, timestamp: Date.now(), type };
  }
}

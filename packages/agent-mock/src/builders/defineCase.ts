import { splitTextIntoChunks } from '../snapshot/chunkSplitter';
import type { MockCase, MockEvent } from '../types';
import { endEvent, initEvent, stepComplete, stepStart } from './helpers';

export interface LlmStepInput {
  chunkSize?: number;
  durationMs: number;
  reasoning?: string;
  text?: string;
  toolsCalling?: Array<{ identifier: string; apiName: string; arguments: string; id?: string }>;
}

export interface ToolStepInput {
  apiName: string;
  arguments: string;
  durationMs: number;
  error?: { message: string; type?: string };
  identifier: string;
  isClientTool?: boolean;
  result?: unknown;
}

export interface ErrorStepInput {
  message: string;
  type?: string;
}

interface InternalStep {
  __kind: 'llm' | 'tool' | 'error';
  build: (stepIndex: number, ctx: { assistantMessageId: string }) => MockEvent[];
  toolCount: number;
}

export function llmStep(input: LlmStepInput): InternalStep {
  return {
    __kind: 'llm',
    toolCount: 0,
    build(stepIndex, ctx) {
      const chunkSize = input.chunkSize ?? 30;
      const reasoningChunks = input.reasoning
        ? splitTextIntoChunks(input.reasoning, { targetChunkChars: chunkSize, jitter: 0.15 })
        : [];
      const textChunks = input.text
        ? splitTextIntoChunks(input.text, { targetChunkChars: chunkSize, jitter: 0.15 })
        : [];
      const toolsCallingCount = input.toolsCalling?.length ? 1 : 0;
      const totalChunks = reasoningChunks.length + textChunks.length + toolsCallingCount;
      const perDelay =
        totalChunks > 0 ? Math.max(1, Math.floor(input.durationMs / totalChunks)) : 0;

      const events: MockEvent[] = [
        stepStart(stepIndex, 'call_llm'),
        {
          type: 'stream_start',
          data: { assistantMessage: { id: ctx.assistantMessageId } },
          delay: 0,
        },
      ];
      for (const r of reasoningChunks)
        events.push({
          type: 'stream_chunk',
          data: { chunkType: 'reasoning', reasoning: r },
          delay: perDelay,
        });
      for (const t of textChunks)
        events.push({
          type: 'stream_chunk',
          data: { chunkType: 'text', content: t },
          delay: perDelay,
        });
      if (input.toolsCalling?.length) {
        events.push({
          type: 'stream_chunk',
          data: { chunkType: 'tools_calling', toolsCalling: input.toolsCalling },
          delay: perDelay,
        });
      }
      events.push({ type: 'stream_end', data: {}, delay: 0 }, stepComplete(stepIndex, 'call_llm'));
      return events;
    },
  };
}

export function toolStep(input: ToolStepInput): InternalStep {
  return {
    __kind: 'tool',
    toolCount: 1,
    build(stepIndex) {
      const toolCallId = `mock-tc-${stepIndex}-0`;
      const events: MockEvent[] = [
        stepStart(stepIndex, 'call_tool'),
        {
          type: 'tool_start',
          data: {
            parentMessageId: `mock-msg-${stepIndex - 1}`,
            toolCalling: { id: toolCallId, identifier: input.identifier, apiName: input.apiName },
          },
          delay: 0,
        },
      ];
      if (input.isClientTool) {
        events.push({
          type: 'tool_execute',
          data: {
            identifier: input.identifier,
            apiName: input.apiName,
            arguments: input.arguments,
            toolCallId,
            executionTimeoutMs: 30_000,
          },
          delay: 0,
        });
      }
      events.push({
        type: 'tool_end',
        data: {
          isSuccess: !input.error,
          result: input.result,
          payload: { state: input.result },
          ...(input.error ? { error: input.error } : {}),
        },
        delay: input.durationMs,
        label: `tool:${input.apiName}`,
      });
      events.push(stepComplete(stepIndex, 'call_tool'));
      return events;
    },
  };
}

export function errorStep(input: ErrorStepInput): InternalStep {
  return {
    __kind: 'error',
    toolCount: 0,
    build() {
      return [
        {
          type: 'error',
          data: { message: input.message, type: input.type ?? 'AgentRuntimeError' },
          delay: 0,
        },
      ];
    },
  };
}

export interface DefineCaseInput {
  description?: string;
  id: string;
  name: string;
  steps: InternalStep[];
  tags?: string[];
}

export function defineCase(input: DefineCaseInput): MockCase {
  const events: MockEvent[] = [initEvent()];

  let toolCount = 0;
  const assistantMessageId = `mock-msg-${input.id}-0`;
  let totalMs = 0;

  input.steps.forEach((step, idx) => {
    const built = step.build(idx, { assistantMessageId });
    events.push(...built);
    toolCount += step.toolCount;
    totalMs += built.reduce((s, e) => s + (e.delay ?? 0), 0);
  });

  events.push(endEvent());

  return {
    id: input.id,
    name: input.name,
    description: input.description,
    tags: input.tags,
    source: { type: 'fixture', events },
    meta: {
      stepCount: input.steps.length,
      toolCount,
      estimatedDurationMs: totalMs,
    },
  };
}

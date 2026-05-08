import type { ExecutionSnapshot, StepSnapshot } from '@lobechat/agent-tracing';

import type { MockEvent } from '../types';
import { splitTextIntoChunks } from './chunkSplitter';

export interface SnapshotToEventsOptions {
  jitter?: number;
  targetChunkChars?: number;
}

const CLIENT_TOOL_IDENTIFIERS = new Set(['lobe-local-system', 'lobe-page-agent']);

const isClientTool = (identifier: string) => CLIENT_TOOL_IDENTIFIERS.has(identifier);

export function snapshotToEvents(
  snapshot: ExecutionSnapshot,
  opts: SnapshotToEventsOptions = {},
): MockEvent[] {
  const targetChunkChars = opts.targetChunkChars ?? 30;
  const jitter = opts.jitter ?? 0.15;
  const events: MockEvent[] = [];

  const operationId = snapshot.operationId;
  const assistantMessageId = `mock-msg-${operationId}-0`;

  events.push({
    type: 'agent_runtime_init',
    data: { operationId },
    delay: 0,
  });

  for (let i = 0; i < snapshot.steps.length; i++) {
    const step = snapshot.steps[i];
    const isLast = i === snapshot.steps.length - 1;
    appendStep(events, step, { assistantMessageId, targetChunkChars, jitter });
    if (isLast) {
      events.push({ type: 'agent_runtime_end', data: { reason: 'done' }, delay: 0 });
    }
  }

  return events;
}

interface AppendCtx {
  assistantMessageId: string;
  jitter: number;
  targetChunkChars: number;
}

function appendStep(out: MockEvent[], step: StepSnapshot, ctx: AppendCtx) {
  out.push({
    type: 'step_start',
    data: { stepIndex: step.stepIndex, stepType: step.stepType },
    delay: 0,
  });

  if (step.stepType === 'call_llm') {
    appendLlmStep(out, step, ctx);
  } else {
    appendToolStep(out, step);
  }

  out.push({
    type: 'step_complete',
    data: { stepIndex: step.stepIndex, phase: step.stepType, reason: 'completed' },
    delay: 0,
  });
}

function appendLlmStep(out: MockEvent[], step: StepSnapshot, ctx: AppendCtx) {
  out.push({
    type: 'stream_start',
    data: { assistantMessage: { id: ctx.assistantMessageId } },
    delay: 0,
  });

  const reasoningChunks = step.reasoning
    ? splitTextIntoChunks(step.reasoning, {
        targetChunkChars: ctx.targetChunkChars,
        jitter: ctx.jitter,
      })
    : [];
  const textChunks = step.content
    ? splitTextIntoChunks(step.content, {
        targetChunkChars: ctx.targetChunkChars,
        jitter: ctx.jitter,
      })
    : [];

  const toolsCallingChunkCount = step.toolsCalling?.length ? 1 : 0;
  const totalChunks = reasoningChunks.length + textChunks.length + toolsCallingChunkCount;
  const perChunkDelay =
    totalChunks > 0 ? Math.max(1, Math.floor(step.executionTimeMs / totalChunks)) : 0;

  for (const r of reasoningChunks) {
    out.push({
      type: 'stream_chunk',
      data: { chunkType: 'reasoning', reasoning: r },
      delay: perChunkDelay,
    });
  }
  for (const t of textChunks) {
    out.push({
      type: 'stream_chunk',
      data: { chunkType: 'text', content: t },
      delay: perChunkDelay,
    });
  }
  if (step.toolsCalling?.length) {
    out.push({
      type: 'stream_chunk',
      data: { chunkType: 'tools_calling', toolsCalling: step.toolsCalling },
      delay: perChunkDelay,
    });
  }

  out.push({ type: 'stream_end', data: {}, delay: 0 });
}

function appendToolStep(out: MockEvent[], step: StepSnapshot) {
  const tools = step.toolsResult ?? [];
  const perToolDelay =
    tools.length > 0 ? Math.max(1, Math.floor(step.executionTimeMs / tools.length)) : 0;

  tools.forEach((t, idx) => {
    const toolCallId = `mock-tc-${step.stepIndex}-${idx}`;
    out.push({
      type: 'tool_start',
      data: {
        parentMessageId: `mock-msg-${step.stepIndex - 1}`,
        toolCalling: { id: toolCallId, identifier: t.identifier, apiName: t.apiName },
      },
      delay: 0,
    });
    if (isClientTool(t.identifier)) {
      out.push({
        type: 'tool_execute',
        data: {
          identifier: t.identifier,
          apiName: t.apiName,
          arguments: '{}',
          toolCallId,
          executionTimeoutMs: 30_000,
        },
        delay: 0,
      });
    }
    out.push({
      type: 'tool_end',
      data: {
        isSuccess: !(t as any).error,
        result: (t as any).state,
        payload: { state: (t as any).state },
      },
      delay: perToolDelay,
      label: `tool:${t.apiName}#${idx}`,
    });
  });
}

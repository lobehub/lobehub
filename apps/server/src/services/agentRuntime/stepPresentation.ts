import type { StepPresentationData } from './types';

interface StepResultLike {
  events?: any[];
  newState: any;
  nextContext?: any;
}

export interface StepPresentation {
  /**
   * Structured data used by callbacks, webhooks, and the trace recorder.
   */
  presentation: StepPresentationData;
  /**
   * Short single-line summary used in the per-step log entry. Carries enough
   * info for a human scanning logs to recognize what the step did
   * (`[tool] x/y`, `[tools×3] ...`, `[done] reason=max_steps`, `[llm] 💭 "..."`).
   */
  summary: string;
}

/**
 * Pure transform from a runtime step result into the presentation object the
 * rest of the executor needs (afterStep hooks, snapshot recorder, callbacks).
 *
 * Branches on `nextContext.phase`:
 * - `tool_result`         → single-tool result presentation
 * - `tools_batch_result`  → batch result presentation
 * - other                 → LLM-side presentation, with `done`/llm_result derivation
 *
 * Returns both the structured presentation and a one-line `summary` string
 * suitable for the per-step log line in `executeStep`.
 */
export function buildStepPresentation(
  stepResult: StepResultLike,
  executionTimeMs: number,
): StepPresentation {
  const { usage, cost } = stepResult.newState;
  const phase = stepResult.nextContext?.phase;
  const isToolPhase = phase === 'tool_result' || phase === 'tools_batch_result';

  let content: string | undefined;
  let reasoning: string | undefined;
  let toolsCalling: Array<{ apiName: string; arguments?: string; identifier: string }> | undefined;
  let toolsResult:
    | Array<{ apiName: string; identifier: string; isSuccess?: boolean; output?: string }>
    | undefined;
  let summary: string;

  if (phase === 'tool_result') {
    const toolPayload = stepResult.nextContext?.payload as any;
    const toolCall = toolPayload?.toolCall;
    const identifier = toolCall?.identifier || 'unknown';
    const apiName = toolCall?.apiName || 'unknown';
    const output = toolPayload?.data;
    toolsResult = [
      {
        apiName,
        identifier,
        isSuccess: toolPayload?.isSuccess !== false,
        output: serializeToolOutput(output),
      },
    ];
    summary = `[tool] ${identifier}/${apiName}`;
  } else if (phase === 'tools_batch_result') {
    const nextPayload = stepResult.nextContext?.payload as any;
    const toolCount = nextPayload?.toolCount || 0;
    const rawToolResults = nextPayload?.toolResults || [];
    toolsResult = rawToolResults.map((r: any) => ({
      apiName: r.toolCall?.apiName || 'unknown',
      identifier: r.toolCall?.identifier || 'unknown',
      isSuccess: r?.isSuccess !== false,
      output: serializeToolOutput(r.data),
    }));
    const toolNames = toolsResult!.map((r) => `${r.identifier}/${r.apiName}`);
    summary = `[tools×${toolCount}] ${toolNames.join(', ')}`;
  } else {
    // Check for done event first (finish step with no next context).
    const doneEvent = stepResult.events?.find((e) => e.type === 'done') as
      | { reason?: string; reasonDetail?: string; type: 'done' }
      | undefined;

    if (doneEvent) {
      summary = `[done] reason=${doneEvent.reason ?? 'unknown'}`;
    } else {
      // LLM result.
      const llmEvent = stepResult.events?.find((e) => e.type === 'llm_result');
      content = (llmEvent as any)?.result?.content || undefined;
      reasoning = (llmEvent as any)?.result?.reasoning || undefined;

      // Use parsed ChatToolPayload from payload (has identifier + apiName).
      const payloadToolsCalling = (stepResult.nextContext?.payload as any)?.toolsCalling as
        | Array<{ apiName: string; arguments: string; identifier: string }>
        | undefined;
      const hasToolCalls = Array.isArray(payloadToolsCalling) && payloadToolsCalling.length > 0;

      if (hasToolCalls) {
        toolsCalling = payloadToolsCalling.map((tc) => ({
          apiName: tc.apiName,
          arguments: tc.arguments,
          identifier: tc.identifier,
        }));
      }

      summary = buildLLMSummary(content, reasoning, toolsCalling, stepResult);
    }
  }

  // Step-level usage from nextContext.stepUsage.
  const stepUsage = stepResult.nextContext?.stepUsage as Record<string, number> | undefined;

  // Cumulative usage.
  const tokens = usage?.llm?.tokens;

  const presentation: StepPresentationData = {
    content,
    executionTimeMs,
    reasoning,
    stepCost: stepUsage?.cost ?? undefined,
    stepInputTokens: stepUsage?.totalInputTokens ?? undefined,
    stepOutputTokens: stepUsage?.totalOutputTokens ?? undefined,
    stepTotalTokens: stepUsage?.totalTokens ?? undefined,
    stepType: isToolPhase ? ('call_tool' as const) : ('call_llm' as const),
    thinking: !isToolPhase,
    toolsCalling,
    toolsResult,
    totalCost: cost?.total ?? 0,
    totalInputTokens: tokens?.input ?? 0,
    totalOutputTokens: tokens?.output ?? 0,
    totalSteps: stepResult.newState.stepCount ?? 0,
    totalTokens: tokens?.total ?? 0,
  };

  return { presentation, summary };
}

/**
 * Format a cumulative token count for log lines (`12345` → `12.3k`,
 * `2_500_000` → `2.5m`).
 */
export function formatTokenCount(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}m`;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k`;
  return String(total);
}

const serializeToolOutput = (output: unknown): string | undefined => {
  if (typeof output === 'string') return output;
  if (output == null) return undefined;
  return JSON.stringify(output);
};

const buildLLMSummary = (
  content: string | undefined,
  reasoning: string | undefined,
  toolsCalling: Array<{ apiName: string; arguments?: string; identifier: string }> | undefined,
  stepResult: StepResultLike,
): string => {
  const parts: string[] = [];
  if (reasoning) {
    const thinkPreview = reasoning.length > 30 ? reasoning.slice(0, 30) + '...' : reasoning;
    parts.push(`💭 "${thinkPreview}"`);
  }
  if (!content && toolsCalling && toolsCalling.length > 0) {
    parts.push(
      `→ call tools: ${toolsCalling.map((tc) => `${tc.identifier}|${tc.apiName}`).join(', ')}`,
    );
  } else if (content) {
    const preview = content.length > 20 ? content.slice(0, 20) + '...' : content;
    parts.push(`"${preview}"`);
  }
  if (parts.length > 0) return `[llm] ${parts.join(' | ')}`;
  return `[llm] (empty) phase=${stepResult.nextContext?.phase ?? 'none'} events=${stepResult.events?.length ?? 0}`;
};

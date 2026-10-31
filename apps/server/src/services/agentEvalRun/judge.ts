import type { MatchContext } from '@lobechat/eval-rubric';
import type {
  EvalBenchmarkRubric,
  EvalConfig,
  EvalMemorySnapshot,
  EvalRunConfig,
  RubricType,
  UserSystemAgentConfig,
} from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import { initModelRuntimeForRequest } from '@/server/modules/AgentRuntime/llmRelay/oneShot';

import { resolveSystemAgentModelConfig } from '../systemAgent/modelConfig';
import type { EvalRunDeps } from './types';

/**
 * LLM judge for eval grading.
 *
 * `llm-rubric` (and the other LLM matchers) only score when `evaluate()` gets a
 * `matchContext`; without one every case scored 0 with "LLM judge not
 * available". An explicit run judge overrides inherited case, dataset and
 * benchmark defaults, including model/provider settings inside a rubric.
 * Without an override, the case, dataset, benchmark and user defaults apply.
 */

export interface EvalJudge {
  model: string;
  /** An explicit run choice must also override the matcher's payload. */
  override?: boolean;
  provider: string;
}

/** `agent_eval_benchmarks.metadata.judge`: the benchmark's default judge model. */
const benchmarkJudge = (metadata?: Record<string, unknown> | null): Partial<EvalJudge> => {
  const judge = metadata?.judge;
  if (!judge || typeof judge !== 'object') return {};
  const { model, provider } = judge as Partial<EvalJudge>;
  return typeof model === 'string' && typeof provider === 'string' ? { model, provider } : {};
};

export const resolveEvalJudge = async (
  deps: EvalRunDeps,
  params: {
    /** The benchmark's metadata; its `judge` is the default between the eval configs and the run. */
    benchmarkMetadata?: Record<string, unknown> | null;
    evalConfigs?: (EvalConfig | null | undefined)[];
    runConfig?: EvalRunConfig | null;
  },
): Promise<EvalJudge> => {
  if (params.runConfig?.judgeModel && params.runConfig.judgeProvider) {
    return {
      model: params.runConfig.judgeModel,
      override: true,
      provider: params.runConfig.judgeProvider,
    };
  }
  const configured = params.evalConfigs?.find((config) => config?.model && config?.provider);
  const fromBenchmark = benchmarkJudge(params.benchmarkMetadata);
  const override = {
    model: (configured?.model as string | undefined) || fromBenchmark.model,
    provider: (configured?.provider as string | undefined) || fromBenchmark.provider,
  };
  if (override.model && override.provider) {
    return resolveSystemAgentModelConfig({ override, taskKey: 'topic' });
  }

  const settings = await new UserModel(deps.db, deps.userId).getUserSettings();
  const systemAgent = settings?.systemAgent as Partial<UserSystemAgentConfig> | undefined;
  return resolveSystemAgentModelConfig({
    override,
    taskConfig: systemAgent?.topic,
    taskKey: 'topic',
  });
};

/**
 * Evidence limits. The judge's context also has to hold the rules, the input
 * and the reply, so the evidence text is capped: each tool result up to
 * `MAX_RESULT_CHARS`, shrinking towards `MIN_RESULT_CHARS` when an attempt
 * made many calls, so the whole section stays under `EVIDENCE_BUDGET_CHARS`
 * (about 40k tokens). Whatever is cut is marked, so the judge knows a detail
 * may sit in the part it cannot see instead of calling it absent.
 */
const EVIDENCE_BUDGET_CHARS = 160_000;
const MAX_EVIDENCE_TOOL_CALLS = 150;
const MAX_ARGS_CHARS = 2000;
const MAX_RESULT_CHARS = 6000;
const MIN_RESULT_CHARS = 600;
const MAX_ERROR_CHARS = 1000;
const MAX_EVIDENCE_MEMORIES = 60;
const MAX_MEMORY_TEXT_CHARS = 600;

const clip = (value: unknown, max: number) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [${text.length - max} more characters not shown]`;
};

interface EvidenceMessage {
  content?: string | null;
  id: string;
  plugin?: { apiName?: string; arguments?: string; identifier?: string } | null;
  pluginError?: unknown;
  role: string;
}

/**
 * What the judge needs beyond the final reply to grade criteria about actions:
 * this attempt's tool calls with their results, and the Memory the attempt
 * left behind. Messages restored from the case's prior history are left out,
 * so the judge only sees what the agent did in this attempt.
 */
export const buildJudgeEvidence = (params: {
  historyTailMessageId?: string;
  memorySnapshot?: EvalMemorySnapshot;
  messages: EvidenceMessage[];
}): string => {
  const { historyTailMessageId, memorySnapshot, messages } = params;
  const tailIndex = historyTailMessageId
    ? messages.findIndex((message) => message.id === historyTailMessageId)
    : -1;
  const attempt = tailIndex >= 0 ? messages.slice(tailIndex + 1) : messages;

  const toolCalls = attempt.filter((message) => message.role === 'tool' && message.plugin);
  const shown = toolCalls.slice(0, MAX_EVIDENCE_TOOL_CALLS);
  const resultChars = Math.max(
    MIN_RESULT_CHARS,
    Math.min(
      MAX_RESULT_CHARS,
      Math.floor(EVIDENCE_BUDGET_CHARS / Math.max(1, shown.length)) - MAX_ARGS_CHARS,
    ),
  );
  const sections = [
    toolCalls.length === 0
      ? 'Tool calls: none.'
      : [
          `Tool calls, in order (${toolCalls.length}):`,
          ...shown.map((message, index) => {
            const { apiName, arguments: args, identifier } = message.plugin!;
            const outcome = message.pluginError
              ? `error: ${clip(message.pluginError, MAX_ERROR_CHARS)}`
              : clip(message.content, resultChars);
            return `${index + 1}. ${identifier}.${apiName}(${clip(args, MAX_ARGS_CHARS)}) -> ${outcome}`;
          }),
          ...(toolCalls.length > shown.length
            ? [`… ${toolCalls.length - shown.length} more tool calls not shown.`]
            : []),
        ].join('\n'),
  ];

  if (memorySnapshot) {
    const rows = memorySnapshot.entries ?? [];
    sections.push(
      [
        `Memory at the end of the attempt (${rows.length} entries; "fixture" ones existed before it started, "agent" ones were written during it):`,
        ...rows.slice(0, MAX_EVIDENCE_MEMORIES).map((row) => {
          const captured = row.capturedAt ? row.capturedAt.slice(0, 10) : '';
          const removed = row.removedReason ? ', removed' : '';
          return `- [${row.layer}, ${row.source}${captured ? `, ${captured}` : ''}${removed}] ${clip(row.title ?? '', 120)}: ${clip(row.summary ?? row.details ?? '', MAX_MEMORY_TEXT_CHARS)}`;
        }),
        ...(rows.length > MAX_EVIDENCE_MEMORIES
          ? [`… ${rows.length - MAX_EVIDENCE_MEMORIES} more entries not shown.`]
          : []),
      ].join('\n'),
    );
  }

  return sections.join('\n\n');
};

/** Builds the judge context; the model runtime starts on the first LLM rubric only. */
export const createJudgeMatchContext = (
  deps: EvalRunDeps,
  judge: EvalJudge,
  evidence?: string,
): MatchContext & { judgeRequests: Array<{ model: string; provider: string }> } => {
  const runtimes = new Map<string, ReturnType<typeof initModelRuntimeForRequest>>();
  const judgeRequests: Array<{ model: string; provider: string }> = [];

  return {
    generateObject: async (payload) => {
      const model = judge.override ? judge.model : payload.model || judge.model;
      const provider = judge.override ? judge.provider : payload.provider || judge.provider;
      if (
        !judgeRequests.some((request) => request.model === model && request.provider === provider)
      ) {
        judgeRequests.push({ model, provider });
      }
      let runtime = runtimes.get(provider);
      if (!runtime) {
        runtime = initModelRuntimeForRequest(deps.db, deps.userId, provider, {
          workspaceId: deps.workspaceId,
        });
        runtimes.set(provider, runtime);
      }
      return ((await runtime) as any).generateObject(
        {
          messages: payload.messages as any[],
          model,
          schema: { name: 'judge_score', schema: payload.schema },
        },
        { metadata: { trigger: 'eval-judge' } },
      );
    },
    judgeEvidence: evidence,
    judgeModel: judge.model,
    judgeRequests,
  };
};

/**
 * The rubric an `evalMode` grades with. The eval UI stores the judge
 * instructions as `judgePrompt`, while the LLM matchers read `criteria`, so
 * the prompt users wrote was never used; map it across.
 */
export const buildEvalModeRubric = (
  evalMode: RubricType,
  evalConfig?: EvalConfig | null,
): EvalBenchmarkRubric => {
  const config = { ...evalConfig } as Record<string, unknown>;
  if (!config.criteria && typeof config.judgePrompt === 'string') {
    config.criteria = config.judgePrompt;
  }

  return {
    config: config as unknown as EvalBenchmarkRubric['config'],
    id: `eval-mode-${evalMode}`,
    name: evalMode,
    type: evalMode,
    weight: 1,
  };
};

import {
  AmbiguousSnapshotIdError,
  type ExecutionSnapshot,
  loadSnapshot,
  MissingTracingBaseUrlError,
} from '@lobechat/agent-tracing';
import { match } from '@lobechat/eval-rubric';
import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { getAuthInfo } from '../../api/http';
import { log } from '../../utils/logger';
import { createJudgeContext } from './judge';
import {
  buildReplayRequest,
  extractCompletionText,
  extractToolCalls,
  type FrozenCall,
  listReplayableSteps,
  type ModelTarget,
  parseModelTargets,
  selectFrozenCall,
} from './payload';

const DEFAULT_JUDGE_MODEL = 'openai/gpt-4o-mini';
const JUDGE_THRESHOLD = 0.6;

export interface ReplayAttempt {
  content: string;
  durationMs: number;
  error?: string;
  judge?: { passed: boolean; reason?: string; score: number };
  model: string;
  toolCalls: Array<{ arguments?: string; name: string }>;
  usage?: { completionTokens?: number; promptTokens?: number };
}

const parseIntOption = (name: string) => (value: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new InvalidArgumentError(`${name} must be an integer`);
  return parsed;
};

const parseFloatOption = (name: string) => (value: string) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new InvalidArgumentError(`${name} must be a number`);
  return parsed;
};

export function registerReplayCommand(parent: Command) {
  parent
    .command('replay')
    .description('Re-issue a frozen LLM call from an execution snapshot against one or more models')
    .argument(
      '[target]',
      'Operation id, trace id, snapshot json path, URL, or "latest" (default: latest local)',
    )
    .option(
      '-s, --step <n>',
      'Snapshot step index to replay (default: the last call_llm step)',
      parseIntOption('--step'),
    )
    .option(
      '-m, --model <list>',
      'Comma-separated provider/model targets (default: the model the snapshot ran on)',
    )
    .option('--judge <criteria>', 'Score every replayed output with an llm-rubric criteria')
    .option('--judge-model <model>', 'Judge model as provider/model', DEFAULT_JUDGE_MODEL)
    .option('--no-tools', 'Drop tool definitions from the replayed payload')
    .option('--temperature <n>', 'Override temperature', parseFloatOption('--temperature'))
    .option('--max-tokens <n>', 'Override max output tokens', parseIntOption('--max-tokens'))
    .option('--json', 'Output JSON')
    .action(
      async (
        target: string | undefined,
        options: {
          json?: boolean;
          judge?: string;
          judgeModel: string;
          maxTokens?: number;
          model?: string;
          step?: number;
          temperature?: number;
          tools: boolean;
        },
      ) => {
        const snapshot = await resolveOrExit(target);
        const call = selectFrozenCall(snapshot, options.step);

        if (!call) {
          const steps = listReplayableSteps(snapshot);
          log.error(
            options.step === undefined
              ? 'Snapshot has no call_llm step with a recorded payload — nothing to replay.'
              : `Step ${options.step} is not a replayable call_llm step. Available: ${steps.join(', ') || '(none)'}`,
          );
          process.exit(1);
          return;
        }

        let targets: ModelTarget[];
        try {
          targets = options.model
            ? parseModelTargets(options.model, snapshot.provider)
            : originalTarget(snapshot);
        } catch (error) {
          log.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
          return;
        }

        const { serverUrl, headers } = await getAuthInfo();

        const judgeContext = options.judge
          ? createJudgeContext({
              headers,
              judgeModel: parseModelTargets(options.judgeModel)[0],
              serverUrl,
            })
          : undefined;

        if (!options.json) printHeader(snapshot, call, targets);

        const attempts: ReplayAttempt[] = [];
        for (const modelTarget of targets) {
          const attempt = await replayOnce({
            call,
            headers,
            maxTokens: options.maxTokens,
            serverUrl,
            target: modelTarget,
            temperature: options.temperature,
            withTools: options.tools,
          });

          if (options.judge && judgeContext && !attempt.error) {
            attempt.judge = await judgeAttempt(attempt.content, options.judge, judgeContext);
          }

          attempts.push(attempt);
          if (!options.json) printAttempt(attempt);
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                attempts,
                operationId: snapshot.operationId,
                originalModel: snapshot.model,
                stepIndex: call.stepIndex,
              },
              null,
              2,
            ),
          );
        }
      },
    );
}

const originalTarget = (snapshot: ExecutionSnapshot): ModelTarget[] => {
  if (!snapshot.model || !snapshot.provider) {
    throw new Error(
      'Snapshot does not record a model/provider — pass targets explicitly with --model provider/model',
    );
  }
  return [
    {
      label: `${snapshot.provider}/${snapshot.model}`,
      model: snapshot.model,
      provider: snapshot.provider,
    },
  ];
};

const resolveOrExit = async (target?: string): Promise<ExecutionSnapshot> => {
  try {
    const snapshot = await loadSnapshot(target, { allowDownload: true });
    if (snapshot) return snapshot;
    log.error(`No snapshot found for "${target ?? 'latest'}".`);
  } catch (error) {
    if (error instanceof MissingTracingBaseUrlError || error instanceof AmbiguousSnapshotIdError) {
      log.error(error.message);
    } else {
      log.error(error instanceof Error ? error.message : String(error));
    }
  }
  process.exit(1);
};

interface ReplayOnceParams {
  call: FrozenCall;
  headers: Record<string, string>;
  maxTokens?: number;
  serverUrl: string;
  target: ModelTarget;
  temperature?: number;
  withTools: boolean;
}

export const replayOnce = async ({
  call,
  headers,
  maxTokens,
  serverUrl,
  target,
  temperature,
  withTools,
}: ReplayOnceParams): Promise<ReplayAttempt> => {
  const request = buildReplayRequest({ call, maxTokens, target, temperature, withTools });
  const startedAt = Date.now();

  try {
    const res = await fetch(`${serverUrl}/webapi/chat/${target.provider}`, {
      body: JSON.stringify(request),
      headers,
      method: 'POST',
    });

    if (!res.ok) {
      return {
        content: '',
        durationMs: Date.now() - startedAt,
        error: `${res.status} ${await res.text()}`,
        model: target.label,
        toolCalls: [],
      };
    }

    const body = (await res.json()) as {
      usage?: { completion_tokens?: number; prompt_tokens?: number };
    };

    return {
      content: extractCompletionText(body),
      durationMs: Date.now() - startedAt,
      model: target.label,
      toolCalls: extractToolCalls(body),
      usage: {
        completionTokens: body?.usage?.completion_tokens,
        promptTokens: body?.usage?.prompt_tokens,
      },
    };
  } catch (error) {
    return {
      content: '',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      model: target.label,
      toolCalls: [],
    };
  }
};

const judgeAttempt = async (
  actual: string,
  criteria: string,
  context: ReturnType<typeof createJudgeContext>,
): Promise<ReplayAttempt['judge']> => {
  const result = await match(
    {
      actual,
      expected: undefined,
      input: '',
      rubric: {
        config: { criteria },
        id: 'replay-judge',
        name: 'replay-judge',
        threshold: JUDGE_THRESHOLD,
        type: 'llm-rubric',
        weight: 1,
      },
    },
    context,
  );

  return { passed: result.passed, reason: result.reason, score: result.score };
};

const printHeader = (snapshot: ExecutionSnapshot, call: FrozenCall, targets: ModelTarget[]) => {
  console.log(pc.bold('Replaying frozen call'));
  console.log(`  operation  ${snapshot.operationId}`);
  console.log(`  recorded   ${snapshot.provider ?? '?'}/${snapshot.model ?? '?'}`);
  console.log(
    `  step       ${call.stepIndex} — ${call.messages.length} messages, ${call.tools?.length ?? 0} tools`,
  );
  console.log(`  targets    ${targets.map((t) => t.label).join(', ')}`);
  console.log('');
};

const printAttempt = (attempt: ReplayAttempt) => {
  console.log(pc.bold(pc.cyan(`── ${attempt.model}`)));

  if (attempt.error) {
    console.log(pc.red(`  error: ${attempt.error}`));
    console.log('');
    return;
  }

  const meta = [
    `${attempt.durationMs}ms`,
    attempt.usage?.promptTokens !== undefined ? `in ${attempt.usage.promptTokens}` : undefined,
    attempt.usage?.completionTokens !== undefined
      ? `out ${attempt.usage.completionTokens}`
      : undefined,
  ]
    .filter(Boolean)
    .join('  ');
  console.log(pc.dim(`  ${meta}`));

  if (attempt.judge) {
    const verdict = attempt.judge.passed ? pc.green('PASS') : pc.red('FAIL');
    console.log(
      `  ${verdict} ${attempt.judge.score.toFixed(2)} ${pc.dim(attempt.judge.reason ?? '')}`,
    );
  }

  for (const toolCall of attempt.toolCalls) {
    console.log(pc.yellow(`  → ${toolCall.name}(${toolCall.arguments ?? ''})`));
  }

  console.log('');
  console.log(attempt.content || pc.dim('(empty response)'));
  console.log('');
};

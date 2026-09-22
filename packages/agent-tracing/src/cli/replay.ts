import type { Command } from 'commander';

import {
  judgeReplay,
  listReplayableSteps,
  type ModelTarget,
  parseModelTargets,
  type ReplayAttempt,
  type ReplayConnection,
  replayFrozenCall,
  replayTrajectory,
  selectFrozenCall,
} from '../replay';
import { loadSnapshot } from '../store/loadSnapshot';
import type { ExecutionSnapshot } from '../types';

const DEFAULT_JUDGE_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_SERVER_URL = 'https://app.lobehub.com';

/**
 * Replay reaches a model through the LobeHub chat route, which needs a token.
 * The `lh` CLI has a credential store; this dev-tool CLI does not, so it reads
 * the same env vars `lh` honours and says so when they are missing.
 */
const resolveConnection = (): ReplayConnection => {
  const token = process.env.LOBEHUB_JWT;
  if (!token) {
    throw new Error(
      'Replay needs a LobeHub token. Either set LOBEHUB_JWT (and optionally ' +
        'LOBEHUB_SERVER_URL), or use `lh trace op replay`, which uses your ' +
        '`lh login` session.',
    );
  }

  return {
    headers: { 'Content-Type': 'application/json', 'Oidc-Auth': token },
    serverUrl: process.env.LOBEHUB_SERVER_URL || DEFAULT_SERVER_URL,
  };
};

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

export function registerReplayCommand(program: Command) {
  program
    .command('replay')
    .description('Re-issue a frozen LLM call from a snapshot against one or more models')
    .argument('[target]', 'Operation id, trace id, snapshot json path, URL, or "latest"')
    .option('-s, --step <n>', 'Snapshot step index to replay (default: the last call_llm step)')
    .option('-m, --model <list>', 'Comma-separated provider/model targets')
    .option('--all-steps', 'Replay every call of the operation against its own recorded payload')
    .option('--concurrency <n>', 'How many calls to replay at once with --all-steps')
    .option('--judge <criteria>', 'Score every replayed output with an llm-rubric criteria')
    .option('--judge-model <model>', 'Judge model as provider/model', DEFAULT_JUDGE_MODEL)
    .option('--no-tools', 'Drop tool definitions from the replayed payload')
    .option('--temperature <n>', 'Override temperature')
    .option('--max-tokens <n>', 'Override max output tokens')
    .option('-j, --json', 'Output as JSON')
    .action(
      async (
        target: string | undefined,
        opts: {
          allSteps?: boolean;
          concurrency?: string;
          json?: boolean;
          judge?: string;
          judgeModel: string;
          maxTokens?: string;
          model?: string;
          step?: string;
          temperature?: string;
          tools: boolean;
        },
      ) => {
        const snapshot = await loadSnapshot(target, { allowDownload: true }).catch(
          (error: unknown) => {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
          },
        );

        if (!snapshot) {
          console.error(`Snapshot not found: ${target ?? 'latest'}`);
          process.exit(1);
        }

        const allSteps = Boolean(opts.allSteps);
        const stepIndex = opts.step === undefined ? undefined : Number.parseInt(opts.step, 10);
        const call = allSteps ? undefined : selectFrozenCall(snapshot, stepIndex);

        if (!allSteps && !call) {
          console.error(
            stepIndex === undefined
              ? 'Snapshot has no call_llm step with a recorded payload — nothing to replay.'
              : `Step ${stepIndex} is not a replayable call_llm step. Available: ${listReplayableSteps(snapshot).join(', ') || '(none)'}`,
          );
          process.exit(1);
        }

        let targets: ModelTarget[];
        let judgeModel: ModelTarget | undefined;
        let connection: ReplayConnection;
        try {
          targets = opts.model
            ? parseModelTargets(opts.model, snapshot.provider)
            : originalTarget(snapshot);
          judgeModel = opts.judge || allSteps ? parseModelTargets(opts.judgeModel)[0] : undefined;
          connection = resolveConnection();
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
        }

        if (allSteps) {
          const result = await replayTrajectory({
            concurrency:
              opts.concurrency === undefined ? undefined : Number.parseInt(opts.concurrency, 10),
            connection,
            maxTokens:
              opts.maxTokens === undefined ? undefined : Number.parseInt(opts.maxTokens, 10),
            onNode: opts.json
              ? undefined
              : (node) =>
                  console.log(
                    `${node.divergence ? '≠' : '✓'} node ${node.nodeIndex + 1} (step ${node.stepIndex})` +
                      (node.divergence
                        ? `  ${node.divergence.field}: recorded ${node.divergence.recorded || '(final answer)'} / replayed ${node.divergence.replayed || '(final answer)'}`
                        : ''),
                  ),
            verdictJudge: judgeModel ? { criteria: opts.judge, judgeModel } : undefined,
            snapshot,
            target: targets[0],
            temperature:
              opts.temperature === undefined ? undefined : Number.parseFloat(opts.temperature),
            withTools: opts.tools,
          });

          console.log(
            opts.json
              ? JSON.stringify({ ...result, operationId: snapshot.operationId }, null, 2)
              : (result.verdict
                  ? `\n${result.verdict.passed ? 'PASS' : 'FAIL'} ${result.verdict.score.toFixed(2)}  ${result.verdict.reason ?? ''}`
                  : '\nno verdict — pass a judge model to get pass / fail') +
                  `\n${result.totalNodes} calls, ` +
                  `${result.nodes.filter((node) => !node.divergence && !node.attempt.error).length}` +
                  ` took the recorded tool route`,
          );
          return;
        }

        if (!call) return;

        if (!opts.json) {
          console.error(
            `Replaying ${snapshot.operationId} step ${call.stepIndex} ` +
              `(${call.messages.length} messages, ${call.tools?.length ?? 0} tools) ` +
              `on ${targets.map((t) => t.label).join(', ')}`,
          );
        }

        const attempts: ReplayAttempt[] = [];
        for (const modelTarget of targets) {
          const attempt = await replayFrozenCall({
            call,
            connection,
            maxTokens:
              opts.maxTokens === undefined ? undefined : Number.parseInt(opts.maxTokens, 10),
            target: modelTarget,
            temperature:
              opts.temperature === undefined ? undefined : Number.parseFloat(opts.temperature),
            withTools: opts.tools,
          });

          if (opts.judge && judgeModel && !attempt.error) {
            attempt.judge = await judgeReplay({
              actual: attempt.content,
              connection,
              criteria: opts.judge,
              judgeModel,
            });
          }

          attempts.push(attempt);

          if (!opts.json) {
            console.log(`\n── ${attempt.model}`);
            if (attempt.error) {
              console.log(`  error: ${attempt.error}`);
              continue;
            }
            console.log(`  ${attempt.durationMs}ms`);
            if (attempt.judge) {
              console.log(
                `  ${attempt.judge.passed ? 'PASS' : 'FAIL'} ${attempt.judge.score.toFixed(2)} ${attempt.judge.reason ?? ''}`,
              );
            }
            for (const toolCall of attempt.toolCalls) {
              console.log(`  → ${toolCall.name}(${toolCall.arguments ?? ''})`);
            }
            console.log(`\n${attempt.content || '(empty response)'}`);
          }
        }

        if (opts.json) {
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

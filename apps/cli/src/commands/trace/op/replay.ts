import {
  type DivergencePolicy,
  type ExecutionSnapshot,
  type FrozenCall,
  judgeReplay,
  listFrozenCalls,
  listReplayableSteps,
  type ModelTarget,
  parseModelTargets,
  type ReplayAttempt,
  type ReplayConnection,
  replayFrozenCall,
  replayTrajectory,
  selectFrozenCall,
} from '@lobechat/agent-tracing';
import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import pc from 'picocolors';

import { getAuthInfo } from '../../../api/http';
import { log } from '../../../utils/logger';
import { resolveSnapshotOrExit } from './snapshot';
import { printTrajectoryNode, printTrajectorySummary } from './trajectoryView';

const DEFAULT_JUDGE_MODEL = 'openai/gpt-4o-mini';

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

export function registerOpReplayCommand(parent: Command) {
  parent
    .command('replay')
    .description('Re-issue a frozen LLM call from a recorded operation against one or more models')
    .argument('[target]', 'Operation id, trace id, snapshot json path, URL, or "latest"')
    .option(
      '-s, --step <n>',
      'Snapshot step index to replay (default: the last call_llm step)',
      parseIntOption('--step'),
    )
    .option(
      '-m, --model <list>',
      'Comma-separated provider/model targets (default: the model the operation ran on)',
    )
    .option(
      '--chain',
      'Replay every call as a node, feeding each output into the next, and report where it leaves the recorded trajectory',
    )
    .option(
      '--all-steps',
      'Replay every call against its own recorded payload, so one divergence cannot contaminate later nodes',
    )
    .option(
      '--on-divergence <policy>',
      'What --chain does at the first tool-call divergence: stop | continue',
      'stop',
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
          allSteps?: boolean;
          chain?: boolean;
          json?: boolean;
          judge?: string;
          judgeModel: string;
          maxTokens?: number;
          model?: string;
          onDivergence: DivergencePolicy;
          step?: number;
          temperature?: number;
          tools: boolean;
        },
      ) => {
        const snapshot = await resolveSnapshotOrExit(target);
        const trajectoryMode = options.chain ? 'chain' : options.allSteps ? 'anchored' : undefined;

        if (trajectoryMode && options.step !== undefined) {
          log.error('--step replays a single call; drop it to replay the whole trajectory.');
          process.exit(1);
          return;
        }
        if (!['continue', 'stop'].includes(options.onDivergence)) {
          log.error('--on-divergence must be "stop" or "continue".');
          process.exit(1);
          return;
        }

        const call = trajectoryMode ? undefined : selectFrozenCall(snapshot, options.step);

        if (!trajectoryMode && !call) {
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
        let judgeModel: ModelTarget | undefined;
        try {
          targets = options.model
            ? parseModelTargets(options.model, snapshot.provider)
            : originalTarget(snapshot);
          // Trajectory runs always score reproduction against the recorded output,
          // so they need a judge even when no behavioural criteria was given.
          judgeModel =
            options.judge || trajectoryMode ? parseModelTargets(options.judgeModel)[0] : undefined;
        } catch (error) {
          log.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
          return;
        }

        const { serverUrl, headers } = await getAuthInfo();
        const connection: ReplayConnection = { headers, serverUrl };

        if (trajectoryMode) {
          if (targets.length > 1) {
            log.error('Trajectory replay runs one model at a time — pass a single --model.');
            process.exit(1);
            return;
          }

          if (!options.json) printTrajectoryHeader(snapshot, targets[0], trajectoryMode);

          const result = await replayTrajectory({
            connection,
            maxTokens: options.maxTokens,
            mode: trajectoryMode,
            onDivergence: options.onDivergence,
            onNode: options.json
              ? undefined
              : (node) => printTrajectoryNode(node, listReplayableSteps(snapshot).length),
            reproductionJudge: judgeModel ? { judgeModel } : undefined,
            snapshot,
            target: targets[0],
            temperature: options.temperature,
            withTools: options.tools,
          });

          if (options.json) {
            console.log(JSON.stringify({ ...result, operationId: snapshot.operationId }, null, 2));
          } else {
            printTrajectorySummary(result);
          }
          return;
        }

        if (!call) return;

        if (!options.json) printHeader(snapshot, call, targets);

        const attempts: ReplayAttempt[] = [];
        for (const modelTarget of targets) {
          const attempt = await replayFrozenCall({
            call,
            connection,
            maxTokens: options.maxTokens,
            target: modelTarget,
            temperature: options.temperature,
            withTools: options.tools,
          });

          if (options.judge && judgeModel && !attempt.error) {
            attempt.judge = await judgeReplay({
              actual: attempt.content,
              connection,
              criteria: options.judge,
              judgeModel,
            });
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

/**
 * Traces do not record sampling parameters, so a replay runs at the server's
 * current defaults for them. Say so where the comparison is set up, rather than
 * letting a run that used non-default temperature or reasoning settings read as
 * a clean model-to-model comparison. Disappears once a trace carries them.
 */
const printParamsCaveat = (call?: FrozenCall) => {
  if (call?.params && Object.keys(call.params).length > 0) return;
  console.log(pc.dim('  note       sampling params are not recorded; replay uses server defaults'));
};

const printTrajectoryHeader = (
  snapshot: ExecutionSnapshot,
  target: ModelTarget,
  mode: 'anchored' | 'chain',
) => {
  console.log(pc.bold(mode === 'chain' ? 'Chained trajectory replay' : 'Per-node replay'));
  console.log(`  operation  ${snapshot.operationId}`);
  console.log(`  recorded   ${snapshot.provider ?? '?'}/${snapshot.model ?? '?'}`);
  console.log(`  target     ${target.label}`);
  printParamsCaveat(listFrozenCalls(snapshot)[0]);
  console.log('');
};

const printHeader = (snapshot: ExecutionSnapshot, call: FrozenCall, targets: ModelTarget[]) => {
  console.log(pc.bold('Replaying frozen call'));
  console.log(`  operation  ${snapshot.operationId}`);
  console.log(`  recorded   ${snapshot.provider ?? '?'}/${snapshot.model ?? '?'}`);
  console.log(
    `  step       ${call.stepIndex} — ${call.messages.length} messages, ${call.tools?.length ?? 0} tools`,
  );
  console.log(`  targets    ${targets.map((t) => t.label).join(', ')}`);
  printParamsCaveat(call);
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
    attempt.usage?.promptTokens === undefined ? undefined : `in ${attempt.usage.promptTokens}`,
    attempt.usage?.completionTokens === undefined
      ? undefined
      : `out ${attempt.usage.completionTokens}`,
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

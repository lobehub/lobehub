import type { Command } from 'commander';

import type { TrpcClient } from '../../api/client';
import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';

const CLEAR_VALUES = new Set(['none', 'null']);

/**
 * `--model` / `--provider` as the goal model mutations take them: both set, or
 * `null` (model "none"/"null") to drop the override. Unlike a Task, a goal
 * override is always stored as a pair, so a model needs its provider.
 */
export const parseGoalModelConfig = (
  options: { model?: string; provider?: string },
  flags = { model: '--model', provider: '--provider' },
): { model: string; provider: string } | null | undefined => {
  const model = options.model?.trim();
  const provider = options.provider?.trim();
  if (!model) {
    if (provider) throw new Error(`${flags.provider} requires ${flags.model}`);
    return undefined;
  }
  if (CLEAR_VALUES.has(model.toLowerCase())) return null;
  if (!provider) throw new Error(`${flags.model} requires ${flags.provider}`);
  return { model, provider };
};

/**
 * `lh goal create --task-model` travels with the create call, so the server
 * applies it before the first coordinator step. This CLI ships on its own: a
 * server that predates the field drops it, which shows as a goal without the
 * model, and only then does the follow-up mutation apply it. That late write
 * can miss a Task already started; a refusal keeps the goal and says how to retry.
 * It is skipped while a planning turn is open: the turn's snapshot covers the goal
 * config, so writing now would make the printed token's first plan stale.
 */
export const ensureCreatedGoalTaskModel = async (
  client: TrpcClient,
  goal: { config?: { taskModel?: string | null } | null; id: string },
  modelConfig: { model: string; provider: string } | null | undefined,
  turnToken?: string,
) => {
  if (!modelConfig || goal.config?.taskModel === modelConfig.model) return;
  if (turnToken) {
    log.warn(
      `This server did not apply --task-model. Submit the plan first, then run: lh goal set-task-model ${goal.id} --model ${modelConfig.model} --provider ${modelConfig.provider}`,
    );
    process.exitCode = 1;
    return;
  }
  try {
    await client.goal.setTaskModel.mutate({ id: goal.id, modelConfig });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(
      `Goal created, but its task model was not set (${message}). Retry: lh goal set-task-model ${goal.id} --model ${modelConfig.model} --provider ${modelConfig.provider}`,
    );
    // The goal exists, so finish the output, but scripts must see the flag did not apply.
    process.exitCode = 1;
  }
};

/** Who and which model a goal's planning and Tasks run on. */
export function registerGoalAssignmentCommands(goal: Command) {
  goal
    .command('set-agent <id> <agent>')
    .description(
      'Hand the goal to a different supervising agent (its unfinished tasks follow unless the goal has a task agent)',
    )
    .option('--goal-only', 'Only change the goal-level agent; leave existing tasks as assigned')
    .action(async (id: string, agentId: string, options: { goalOnly?: boolean }) => {
      const result = await (
        await getTrpcClient()
      ).goal.setAgent.mutate({ agentId, goalOnly: options.goalOnly, id });
      log.info(result.message);
    });

  goal
    .command('set-task-agent <id> <agent>')
    .description(
      'Route the goal\'s tasks to a dedicated executor; "none" hands them back to the goal agent',
    )
    .option('--goal-only', 'Only change future tasks; leave existing tasks as assigned')
    .action(async (id: string, agent: string, options: { goalOnly?: boolean }) => {
      const result = await (
        await getTrpcClient()
      ).goal.setTaskAgent.mutate({
        agentId: agent === 'none' ? null : agent,
        goalOnly: options.goalOnly,
        id,
      });
      log.info(result.message);
    });

  goal
    .command('set-model <id>')
    .description(
      'Pick the model the goal agent plans with; --model none returns to the agent default',
    )
    .requiredOption('--model <model>', 'Model ID, or "none" to clear the override')
    .option('--provider <provider>', 'Provider of --model (required unless clearing)')
    .action(async (id: string, options: { model: string; provider?: string }) => {
      const modelConfig = parseGoalModelConfig(options) ?? null;
      const result = await (await getTrpcClient()).goal.setModel.mutate({ id, modelConfig });
      log.info(result?.message ?? 'Goal model updated');
    });

  goal
    .command('set-task-model <id>')
    .description(
      "Pick the model every task of the goal runs on (unfinished tasks switch too); --model none returns them to their executor's model",
    )
    .requiredOption('--model <model>', 'Model ID, or "none" to clear the override')
    .option('--provider <provider>', 'Provider of --model (required unless clearing)')
    .action(async (id: string, options: { model: string; provider?: string }) => {
      const modelConfig = parseGoalModelConfig(options) ?? null;
      const result = await (await getTrpcClient()).goal.setTaskModel.mutate({ id, modelConfig });
      log.info(result?.message ?? 'Goal task model updated');
    });
}

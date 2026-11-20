import path from 'node:path';

import type { Command } from 'commander';

import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';
import { adoptSwarmLane, promoteSwarmLane, stakeSwarmLanes } from '../../utils/swarmLane';

const DURATION = /^(\d+(?:\.\d+)?)\s*(m|min|h|d)$/i;

/** `2h`, `90m`, `1d` from now, or an ISO instant, as an ISO instant. */
export const resolveDeadline = (value: string, now = Date.now()): string => {
  const duration = DURATION.exec(value.trim());
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2].toLowerCase();
    const ms = unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000;
    return new Date(now + amount * ms).toISOString();
  }
  const at = Date.parse(value);
  if (!Number.isFinite(at))
    throw new Error(`--deadline expects 2h, 90m, 1d or an ISO time; got ${value}`);
  return new Date(at).toISOString();
};

/**
 * Swarm goals: N lanes optimise one objective in copies of a workspace until a
 * deadline, then the best lane is promoted back into the workspace.
 */
export function registerGoalSwarmCommands(goal: Command) {
  goal
    .command('swarm <title>')
    .description(
      'Start a swarm goal: lanes work on copies of a workspace, each graded by the evaluator, until the deadline; the best lane is then promoted into the workspace',
    )
    .requiredOption('--workspace <dir>', 'The workspace directory on the lanes device')
    .requiredOption(
      '--evaluator <command>',
      'Shell command that prints the score, run in each lane',
    )
    .requiredOption('--deadline <when>', 'When the lanes stop: 2h, 90m, 1d, or an ISO time')
    .option('--lanes <n>', 'How many lanes run in parallel (1-8)', '3')
    .option('--direction <max|min>', 'Whether higher or lower is better', 'max')
    .option('--score-title <title>', 'Name of the score')
    .option('-r, --requirement <text>', 'What the lanes should achieve')
    .option('--agent <id>', 'Goal agent (defaults to the current agent)')
    .option('--task-agent <id>', 'Agent that runs the lanes (defaults to the goal agent)')
    .action(
      async (
        title: string,
        options: {
          agent?: string;
          deadline: string;
          direction: string;
          evaluator: string;
          lanes: string;
          requirement?: string;
          scoreTitle?: string;
          taskAgent?: string;
          workspace: string;
        },
      ) => {
        if (options.direction !== 'max' && options.direction !== 'min')
          throw new Error('--direction must be max or min');
        const result = await (
          await getTrpcClient()
        ).goal.createSwarm.mutate({
          agentId: options.agent ?? process.env.LOBEHUB_AGENT_ID,
          deadline: resolveDeadline(options.deadline),
          lanes: Number.parseInt(options.lanes, 10),
          objective: {
            direction: options.direction,
            evaluator: options.evaluator,
            title: options.scoreTitle,
          },
          requirement: options.requirement,
          taskAgentId: options.taskAgent,
          title,
          workspace: path.resolve(options.workspace),
        });
        const swarm = result.data.goal.config?.swarm;
        // Lane keys restart at A per swarm, so claim `.lanes` now: a retry keeps
        // this swarm's lanes, an earlier swarm's copies move out of the way.
        const staked = await stakeSwarmLanes(path.resolve(options.workspace), result.data.goal.id);
        if (!staked)
          log.info(
            `Workspace ${path.resolve(options.workspace)} is not on this machine; lanes will be created on their device.`,
          );
        log.info(
          `Started swarm ${result.data.goal.id}: ${swarm?.lanes.length ?? 0} lanes in ${swarm?.workspace}/.lanes until ${result.data.goal.config?.schedule?.deadline}`,
        );
      },
    );

  const lane = goal.command('lane').description('Work with the lanes of a swarm goal');

  lane
    .command('adopt <lane>')
    .description("From inside your lane, replace its files with another lane's (yours are kept)")
    .action(async (fromKey: string) => {
      const { snapshot, source, target } = await adoptSwarmLane(process.cwd(), fromKey);
      log.info(`Lane ${target} now holds ${source}. Your previous files are in ${snapshot}.`);
    });

  lane
    .command('promote <lane>')
    .description(
      "Copy a lane's files over the workspace (run in the workspace); the old workspace is kept",
    )
    .option('--workspace <dir>', 'The swarm workspace (default: the current directory)')
    .action(async (key: string, options: { workspace?: string }) => {
      const { graded, snapshot, source, target } = await promoteSwarmLane(
        path.resolve(options.workspace ?? process.cwd()),
        key,
      );
      const what = graded
        ? `the files lane ${key} was graded on`
        : `lane ${key}'s current files (it never recorded a leading score)`;
      log.info(
        `Promoted ${what} from ${source} into ${target}. The previous workspace is in ${snapshot}.`,
      );
    });
}

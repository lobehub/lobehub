import { GOAL_MARK_KINDS } from '@lobechat/const/goal';
import type { GoalMarkKind } from '@lobechat/types';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { outputJson } from '../../utils/format';
import { log } from '../../utils/logger';
import { hasOperationToken } from './reads';

interface MarkRow {
  confidence: number;
  confirms: number;
  description: string | null;
  id: string;
  kind: string;
  refutes: number;
  status: string;
  title: string;
}

const KINDS_HELP = `Kinds: ${GOAL_MARK_KINDS.join(', ')}.`;

const parseKind = (kind: string): GoalMarkKind => {
  if (!(GOAL_MARK_KINDS as readonly string[]).includes(kind))
    throw new Error(`Unknown mark kind "${kind}". ${KINDS_HELP}`);
  return kind as GoalMarkKind;
};

const describeMark = (mark: MarkRow) => {
  const record =
    mark.confirms || mark.refutes ? `+${mark.confirms}/-${mark.refutes}` : pc.dim('unconfirmed');
  const retired = mark.status === 'retired' ? pc.dim(' (retired)') : '';
  const lines = [
    `${pc.bold(`[${mark.kind}]`)} ${mark.title} ${record}${retired}`,
    pc.dim(`  id: ${mark.id}`),
  ];
  if (mark.description) lines.push(`  ${mark.description.replaceAll('\n', '\n  ')}`);
  return lines.join('\n');
};

/** Outside a Goal Task run there is no run to stand for, so the goal must be named. */
const requireGoalId = (goalId: string | undefined, command: string) => {
  if (!goalId)
    throw new Error(
      `Pass the goal id: \`lh goal ${command}\` outside a Goal Task run cannot tell which goal you mean.`,
    );
  return goalId;
};

const RUN_ONLY =
  'Only a Goal Task run judges a mark: it records that this run relied on the mark. Run it from inside the Task run.';

/**
 * Marks: the notes runs of one Goal leave for each other.
 *
 * Inside a Goal Task run (an operation token), every command acts for that
 * run's Goal and Task, so no ids are needed. With a person's login, `list`,
 * `add` and `retire` take the goal id; judging is for runs only.
 */
export function registerGoalMarkCommands(goal: Command) {
  const mark = goal
    .command('mark')
    .summary('Notes runs of a goal leave for each other')
    .description(
      [
        'Marks are short notes one run of a goal leaves for every later run: a fix for a pitfall',
        '(pattern), a reusable script (tool), something not to touch (hazard), or an approach',
        'that failed (dead_end). Every Task run of the goal is handed the trusted ones.',
        KINDS_HELP,
      ].join('\n'),
    );

  mark
    .command('add <kind> <title>')
    .description(`Leave a mark for later runs. ${KINDS_HELP}`)
    .option('-d, --description <text>', 'The details: exact error, cause, fix, path, usage')
    .option('--goal <id>', 'The goal, when not run from inside one of its Task runs')
    .action(
      async (kind: string, title: string, options: { description?: string; goal?: string }) => {
        const input = { description: options.description, kind: parseKind(kind), title };
        const client = await getTrpcClient();
        const result = hasOperationToken()
          ? await client.goal.addMarkOperation.mutate(input)
          : await client.goal.addMark.mutate({
              ...input,
              id: requireGoalId(options.goal, 'mark add --goal <id>'),
            });
        log.info(`Left ${input.kind} mark ${result.data.id}`);
      },
    );

  mark
    .command('list [goal-id]')
    .description('List the marks of a goal, newest first')
    .option('--json', 'Output JSON')
    .action(async (goalId: string | undefined, options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const marks: MarkRow[] = hasOperationToken()
        ? (await client.goal.marksOperation.query()).data
        : (await client.goal.marks.query({ id: requireGoalId(goalId, 'mark list <goal-id>') }))
            .data;
      if (options.json) return outputJson(marks);
      if (marks.length === 0) return log.info('No marks yet.');
      console.log(marks.map(describeMark).join('\n\n'));
    });

  for (const [command, verdict, summary] of [
    ['confirm', 'confirms', 'Record that a mark this run relied on held'],
    ['refute', 'refutes', 'Record that a mark this run relied on was wrong'],
  ] as const) {
    mark
      .command(`${command} <mark-id>`)
      .description(summary)
      .action(async (markId: string) => {
        if (!hasOperationToken()) throw new Error(RUN_ONLY);
        const result = await (
          await getTrpcClient()
        ).goal.judgeMarkOperation.mutate({ markId, verdict });
        log.info(
          `Recorded: ${verdict} ${markId} (now +${result.data.confirms}/-${result.data.refutes})`,
        );
      });
  }

  mark
    .command('retire <goal-id> <mark-id>')
    .description('Take a mark out of every later run; it stays on the goal graph')
    .option('--reason <text>', 'Why, kept on the audit trail')
    .action(async (goalId: string, markId: string, options: { reason?: string }) => {
      const result = await (
        await getTrpcClient()
      ).goal.retireMark.mutate({ id: goalId, markId, reason: options.reason });
      log.info(result.message);
    });
}

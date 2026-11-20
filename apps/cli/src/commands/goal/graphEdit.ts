import type { GoalEdgeKind } from '@lobechat/types';
import type { Command } from 'commander';

import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';

/** Edge kinds the server accepts from a hand edit; `revises` is exploration-only. */
const writableEdgeKinds = [
  'depends_on',
  'decomposes',
  'contains',
  'answers',
  'derived_from',
  'investigates',
  'produces',
  'supports',
  'contradicts',
  'leads_to',
] as const satisfies readonly GoalEdgeKind[];

type WritableEdgeKind = (typeof writableEdgeKinds)[number];

const EDGE_DIRECTION_HELP = [
  'Every edge reads `<source> <kind> <target>`. `A depends_on B` means A waits for B: B runs first.',
  '`A blocks B` is accepted too and stored as `B depends_on A`, the way `lh goal show` prints it.',
  `Kinds: ${writableEdgeKinds.join(', ')}, blocks.`,
].join('\n');

/**
 * Resolve the `<source> <target> <kind>` a person typed into the stored edge.
 * `blocks` is the inverse of `depends_on` and the word `lh goal show` prints,
 * so it is the one an agent reaches for; it swaps the ends instead of failing.
 */
export const resolveEdge = (
  sourceNodeId: string,
  targetNodeId: string,
  kind: string,
): { kind: WritableEdgeKind; sourceNodeId: string; targetNodeId: string } => {
  if (kind === 'blocks')
    return { kind: 'depends_on', sourceNodeId: targetNodeId, targetNodeId: sourceNodeId };
  if (!(writableEdgeKinds as readonly string[]).includes(kind))
    throw new Error(`Unknown edge kind "${kind}". ${EDGE_DIRECTION_HELP}`);
  return { kind: kind as WritableEdgeKind, sourceNodeId, targetNodeId };
};

const describeEdge = (edge: { kind: string; sourceNodeId: string; targetNodeId: string }) =>
  `${edge.sourceNodeId.slice(0, 8)} ${edge.kind} ${edge.targetNodeId.slice(0, 8)}`;

/** Hand edits to a Goal Graph: nodes, edges, and retiring tasks that should not run. */
export function registerGoalGraphEditCommands(goal: Command) {
  goal
    .command('retire <id> <node-ids...>')
    .description(
      'Retire task nodes that should not run; unfinished tasks depending on them must be retired together',
    )
    .option('--reason <text>', 'Why the nodes are retired')
    .action(async (id: string, nodeIds: string[], options) => {
      const result = await (
        await getTrpcClient()
      ).goal.retireNodes.mutate({ id, nodeIds, reason: options.reason });
      log.info(result.message);
    });

  goal
    .command('add-node <id> <kind> <title>')
    .description('Add a question, experiment container, task, finding, or decision node')
    .option('--scope <experiment-id>', 'Contain this node in an experiment')
    .option('--question <node-id>', 'Question this experiment answers')
    .option('-d, --description <text>')
    .option('-p, --priority <n>')
    .action(
      async (
        id: string,
        kind: 'decision' | 'experiment' | 'finding' | 'problem' | 'task',
        title: string,
        options,
      ) => {
        const result = await (
          await getTrpcClient()
        ).goal.addNode.mutate({
          description: options.description,
          scopeId: options.scope,
          questionId: options.question,
          id,
          kind,
          priority: options.priority ? Number.parseInt(options.priority, 10) : undefined,
          title,
        });
        log.info(`Created node ${result.data.id}`);
      },
    );

  goal
    .command('add-edge <id> <source> <target> <kind>')
    .summary('Connect two Goal Graph nodes')
    .description(EDGE_DIRECTION_HELP)
    .action(async (id: string, source: string, target: string, kind: string) => {
      const edge = resolveEdge(source, target, kind);
      const result = await (await getTrpcClient()).goal.addEdge.mutate({ id, ...edge });
      log.info(`Created edge ${result.data.id}: ${describeEdge(edge)}`);
    });

  goal
    .command('remove-edge <id> <source> <target> [kind]')
    .summary('Remove an edge from a draft goal')
    .description(
      [
        'Remove the edges from <source> to <target> on a draft goal, or only those of [kind].',
        'A started goal keeps its edges; retire the task nodes instead.',
        '',
        EDGE_DIRECTION_HELP,
      ].join('\n'),
    )
    .option('--reason <text>', 'Why the edge is removed, kept on the audit trail')
    .action(
      async (
        id: string,
        source: string,
        target: string,
        kind: string | undefined,
        options: { reason?: string },
      ) => {
        const edge = kind
          ? resolveEdge(source, target, kind)
          : { kind: undefined, sourceNodeId: source, targetNodeId: target };
        const result = await (
          await getTrpcClient()
        ).goal.removeEdge.mutate({ id, ...edge, reason: options.reason });
        log.info(`${result.message}: ${describeEdge({ ...edge, kind: edge.kind ?? 'any' })}`);
      },
    );
}

import {
  DEFAULT_TASK_LABEL_COLOR,
  describeUnresolvedTaskLabels,
  formatTaskLabelPath,
  resolveTaskLabelRefs,
  type TaskLabelRef,
  type TaskLabelWithUsage,
} from '@lobechat/types';
import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../../api/client';
import { getTrpcClient } from '../../api/client';
import { confirm, outputJson, printTable } from '../../utils/format';
import { log } from '../../utils/logger';

/**
 * Commander collector for a repeatable option: `--label a --label b,c`. Values
 * are kept whole here; {@link expandLabelRefs} splits commas once the registry
 * is known, so a label actually named `Needs, Review` still resolves.
 */
export const collectLabels = (value: string, previous: string[] = []) => {
  const trimmed = value.trim();
  return trimmed ? [...previous, trimmed] : previous;
};

/** A value naming an existing label (or group) is one ref; otherwise split on commas. */
export const expandLabelRefs = (labels: TaskLabelWithUsage[], values: string[]): string[] =>
  values.flatMap((value) => {
    if (!value.includes(',')) return [value];
    const needle = value.toLowerCase();
    const isWhole =
      labels.some((label) => label.name.toLowerCase() === needle) ||
      resolveTaskLabelRefs(labels, [value]).ids.length === 1;
    return isWhole
      ? [value]
      : value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
  });

const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i;

/**
 * Resolve `--label` values against the scope's registry. Unknown names fail
 * with suggestions instead of creating labels, so a typo (by a person or an
 * agent) never grows the shared registry — `lh task label create` does that.
 */
export const resolveLabelIds = async (
  client: TrpcClient,
  names: string[],
  registry?: TaskLabelWithUsage[],
): Promise<string[]> => {
  if (names.length === 0) return [];
  const labels = registry ?? (await client.taskLabel.list.query());
  const { ids, unresolved } = resolveTaskLabelRefs(labels, expandLabelRefs(labels, names));
  if (unresolved.length > 0) {
    throw new Error(
      `${describeUnresolvedTaskLabels(unresolved)}\nRun \`lh task label list\` to see labels, or \`lh task label create <name>\` to add one.`,
    );
  }
  return ids;
};

/** Resolve a single label or label group by name or `Group/Label` path. */
const resolveOne = (labels: TaskLabelWithUsage[], ref: string): TaskLabelWithUsage => {
  const needle = ref.trim().toLowerCase();
  const byName = labels.find((label) => label.name.toLowerCase() === needle);
  if (byName) return byName;
  const { ids, unresolved } = resolveTaskLabelRefs(labels, [ref]);
  if (ids.length === 1) return labels.find((label) => label.id === ids[0])!;
  throw new Error(describeUnresolvedTaskLabels(unresolved));
};

const colorDot = (color?: string | null) => {
  // picocolors' detection covers NO_COLOR, FORCE_COLOR and non-TTY output.
  if (!pc.isColorSupported || !color || !HEX_COLOR.test(color)) return pc.dim('●');
  const hex =
    color.length === 4 ? color.replaceAll(/[\da-f]/gi, (c) => c + c).slice(1) : color.slice(1, 7);
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `\u001B[38;2;${r};${g};${b}m●\u001B[39m`;
};

/** Inline rendering of a task's labels for tables and detail views. */
export const formatTaskLabels = (labels: TaskLabelRef[] | undefined, max = 3): string => {
  if (!labels || labels.length === 0) return '';
  const shown = labels.slice(0, max).map((label) => `${colorDot(label.color)} ${label.name}`);
  const rest = labels.length - max;
  return rest > 0 ? `${shown.join(' ')} ${pc.dim(`+${rest}`)}` : shown.join(' ');
};

const assertColor = (color: string | undefined) => {
  if (color !== undefined && !HEX_COLOR.test(color)) {
    throw new Error(`Invalid color "${color}" — use a hex value such as #EB5757.`);
  }
};

export function registerLabelCommands(task: Command) {
  const label = task.command('label').description('Manage task labels (workspace-shared)');

  label
    .command('list')
    .description('List task labels and label groups')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const labels = await client.taskLabel.list.query();

      if (options.json !== undefined) {
        outputJson(labels, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      if (labels.length === 0) {
        log.info('No task labels yet. Create one with `lh task label create <name>`.');
        return;
      }

      // Top-level labels and groups first, each group followed by its labels.
      const rows: string[][] = [];
      for (const entry of labels.filter((l) => !l.parentId)) {
        rows.push([
          `${colorDot(entry.color)} ${entry.isGroup ? pc.bold(entry.name) : entry.name}`,
          entry.isGroup ? pc.dim('group') : 'label',
          entry.isGroup ? '' : String(entry.usageCount),
        ]);
        for (const child of labels.filter((l) => l.parentId === entry.id)) {
          rows.push([
            `  ${colorDot(child.color)} ${formatTaskLabelPath(child, labels)}`,
            'label',
            String(child.usageCount),
          ]);
        }
      }
      printTable(rows, ['NAME', 'KIND', 'TASKS']);
    });

  label
    .command('create <name>')
    .description('Create a task label (or a label group with --group)')
    .option('--color <hex>', `Label color (default ${DEFAULT_TASK_LABEL_COLOR})`)
    .option('--description <text>', 'Label description')
    .option('--group', 'Create a label group; a task carries at most one label per group')
    .option('--parent <group>', 'Put the label inside this label group')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        name: string,
        options: {
          color?: string;
          description?: string;
          group?: boolean;
          json?: string | boolean;
          parent?: string;
        },
      ) => {
        assertColor(options.color);
        const client = await getTrpcClient();
        let parentId: string | undefined;
        if (options.parent) {
          if (options.group) throw new Error('A label group cannot be nested in another group.');
          const parent = resolveOne(await client.taskLabel.list.query(), options.parent);
          if (!parent.isGroup) throw new Error(`"${parent.name}" is not a label group.`);
          parentId = parent.id;
        }

        const created = await client.taskLabel.create.mutate({
          color: options.color ?? DEFAULT_TASK_LABEL_COLOR,
          description: options.description,
          isGroup: options.group,
          name,
          parentId,
        });

        if (options.json !== undefined) {
          outputJson(created, typeof options.json === 'string' ? options.json : undefined);
          return;
        }
        log.info(`${options.group ? 'Label group' : 'Label'} created: ${pc.bold(created.name)}`);
        console.log(`ID: ${created.id}`);
      },
    );

  label
    .command('edit <label>')
    .description('Rename, recolor or move a task label')
    .option('-n, --name <name>', 'New name')
    .option('--color <hex>', 'New color')
    .option('--description <text>', 'New description')
    .option('--parent <group>', 'Move into this label group ("none" to move out)')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        ref: string,
        options: {
          color?: string;
          description?: string;
          json?: string | boolean;
          name?: string;
          parent?: string;
        },
      ) => {
        assertColor(options.color);
        const client = await getTrpcClient();
        const labels = await client.taskLabel.list.query();
        const target = resolveOne(labels, ref);

        const value: Parameters<typeof client.taskLabel.update.mutate>[0]['value'] = {};
        if (options.name) value.name = options.name;
        if (options.color) value.color = options.color;
        if (options.description !== undefined) value.description = options.description;
        if (options.parent !== undefined) {
          if (options.parent.toLowerCase() === 'none') {
            value.parentId = null;
          } else {
            const parent = resolveOne(labels, options.parent);
            if (!parent.isGroup) throw new Error(`"${parent.name}" is not a label group.`);
            value.parentId = parent.id;
          }
        }
        if (Object.keys(value).length === 0) {
          log.error('Nothing to change — pass --name, --color, --description or --parent.');
          return;
        }

        const updated = await client.taskLabel.update.mutate({ id: target.id, value });
        if (options.json !== undefined) {
          outputJson(updated, typeof options.json === 'string' ? options.json : undefined);
          return;
        }
        log.info(`Label updated: ${pc.bold(updated?.name ?? target.name)}`);
      },
    );

  label
    .command('delete <label>')
    .description('Delete a task label (deleting a group deletes its labels)')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (ref: string, options: { yes?: boolean }) => {
      const client = await getTrpcClient();
      const labels = await client.taskLabel.list.query();
      const target = resolveOne(labels, ref);
      const children = labels.filter((l) => l.parentId === target.id);
      const usage = target.isGroup
        ? children.reduce((sum, child) => sum + child.usageCount, 0)
        : target.usageCount;

      if (!options.yes) {
        const what = target.isGroup
          ? `label group "${target.name}" and its ${children.length} label(s)`
          : `label "${target.name}"`;
        const ok = await confirm(
          // `usageCount` only covers unarchived tasks the caller can see; the
          // delete itself reaches every task carrying the label.
          `Delete ${what}? It is removed from every task that carries it (${usage} unarchived task(s) visible to you). This cannot be undone.`,
        );
        if (!ok) return;
      }

      await client.taskLabel.delete.mutate({ id: target.id });
      log.info(`Deleted ${target.isGroup ? 'label group' : 'label'}: ${pc.bold(target.name)}`);
    });
}

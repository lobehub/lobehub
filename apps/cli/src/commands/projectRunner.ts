import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';

/** The id the cloud sandbox takes in a project's runner order. */
export const SANDBOX_RUNNER_ID = 'sandbox';

interface RunnerRow {
  deviceId?: string | null;
  deviceName?: string | null;
  id: string;
  path: string;
  platform?: string | null;
  runnable?: boolean | null;
  sortOrder?: number | null;
}

export type OrderedRunner =
  | { id: typeof SANDBOX_RUNNER_ID; kind: 'sandbox' }
  | { directory: RunnerRow; id: string; kind: 'device' };

/**
 * A project's runners in its priority order, the way the settings page lists
 * them: by stored place, a device folder before the sandbox on a tie, and
 * folders among themselves in the order the server returned them.
 */
export const orderRunners = (directories: RunnerRow[], sandboxOrder: number): OrderedRunner[] =>
  [
    ...directories.map((directory, index) => ({
      index,
      runner: { directory, id: directory.id, kind: 'device' } as OrderedRunner,
      sortOrder: directory.sortOrder ?? 0,
    })),
    {
      index: directories.length,
      runner: { id: SANDBOX_RUNNER_ID, kind: 'sandbox' } as OrderedRunner,
      sortOrder: sandboxOrder,
    },
  ]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index)
    .map(({ runner }) => runner);

/**
 * `url` or `url@ref`. The ref starts at the first `@` inside the repository
 * path, so a ref may contain slashes (`feature/foo`) and an `@` before the
 * path (userinfo, `git@github.com:`) never counts as one.
 */
export const parseRepositoryArg = (value: string): { ref?: string; url: string } => {
  const scheme = value.indexOf('://');
  const pathStart = value.indexOf('/', scheme === -1 ? 0 : scheme + 3);
  const at = pathStart === -1 ? -1 : value.indexOf('@', pathStart);
  return at === -1
    ? { url: value }
    : { ref: value.slice(at + 1) || undefined, url: value.slice(0, at) };
};

type GitSource = { kind: 'git'; path?: string; ref?: string; setupCommand?: string; url: string };

/** Trailing slashes before `.git`, so `repo.git/` matches `repo`. */
const canonicalRepository = (url: string) =>
  url
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .toLowerCase();

export const sameRepository = (a: string, b: string) =>
  canonicalRepository(a) === canonicalRepository(b);

/** Only git sources carry a URL; a legacy `files` source is kept as is. */
const isRepository = (source: { kind: string; url?: string }, url: string) =>
  source.kind === 'git' && !!source.url && sameRepository(source.url, url);

export function registerProjectRunnerCommands(project: Command) {
  const runner = project
    .command('runner')
    .description(
      "Manage where a project's work runs: the cloud sandbox and device workspace folders",
    );

  runner
    .command('list <projectId>')
    .description('List runners in priority order')
    .option('--json [fields]', 'Output JSON')
    .action(async (projectId: string, options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      const [directories, order, devices] = await Promise.all([
        client.projectWorkingDirectory.list.query({ projectId }),
        client.projectWorkingDirectory.executionOrder.query({ projectId }),
        client.device.listDevices.query().catch(() => undefined),
      ]);
      const online = new Map(
        (devices ?? []).map((device: { deviceId: string; online?: boolean }) => [
          device.deviceId,
          !!device.online,
        ]),
      );
      const runners = orderRunners(directories.data, order.data.sandbox);
      const rows = runners.map((item, index) =>
        item.kind === 'sandbox'
          ? { id: SANDBOX_RUNNER_ID, kind: 'sandbox', priority: index + 1 }
          : {
              device: item.directory.deviceName || item.directory.deviceId,
              deviceId: item.directory.deviceId,
              id: item.id,
              kind: 'device',
              online: item.directory.deviceId ? online.get(item.directory.deviceId) : undefined,
              path: item.directory.path,
              platform: item.directory.platform,
              priority: index + 1,
              runnable: !!item.directory.runnable,
            },
      );
      if (options.json !== undefined) return outputJson(rows, options.json);
      printTable(
        rows.map((row) =>
          row.kind === 'sandbox'
            ? [String(row.priority), SANDBOX_RUNNER_ID, 'Cloud sandbox', '-', '-']
            : [
                String(row.priority),
                row.id,
                truncate(`${row.device ?? ''}${row.platform ? ` (${row.platform})` : ''}`, 32),
                row.online === undefined
                  ? '?'
                  : row.online
                    ? pc.green('online')
                    : pc.dim('offline'),
                truncate(row.path ?? '', 48),
              ],
        ),
        ['#', 'ID', 'RUNNER', 'STATUS', 'WORKSPACE FOLDER'],
      );
    });

  runner
    .command('add <projectId>')
    .description('Add a device and its workspace folder as a runner')
    .requiredOption('--device <deviceId>', 'Device ID (see `lh device list`)')
    .requiredOption('--path <path>', 'Absolute path of the workspace folder on the device')
    .option('--name <name>', 'Display name (defaults to the folder name)')
    .action(async (projectId: string, options: { device: string; name?: string; path: string }) => {
      const client = await getTrpcClient();
      const { data: environment } = await client.projectWorkingDirectory.getEnvironment.query({
        projectId,
      });
      const name = options.name || options.path.split(/[\\/]/).findLast(Boolean) || options.path;
      const { data } = await client.projectWorkingDirectory.bind.mutate({
        deviceId: options.device,
        environmentId: environment.id,
        name,
        path: options.path,
        projectId,
      });
      console.log(`${pc.green('✓')} Added runner ${pc.bold(data.id)} (${options.path})`);
    });

  runner
    .command('remove <projectId> <runnerId>')
    .description('Remove a device runner; files on the device are kept')
    .option('--yes', 'Skip confirmation')
    .action(async (projectId: string, runnerId: string, options: { yes?: boolean }) => {
      if (runnerId === SANDBOX_RUNNER_ID)
        return console.log('The cloud sandbox is always a runner; reorder it instead.');
      if (!options.yes && !(await confirm(`Remove runner ${runnerId}?`))) return;
      await (
        await getTrpcClient()
      ).projectWorkingDirectory.remove.mutate({ id: runnerId, projectId });
      console.log(`${pc.green('✓')} Removed runner ${pc.bold(runnerId)}`);
    });

  runner
    .command('reorder <projectId> <runnerIds...>')
    .description(`Set the priority order; use "${SANDBOX_RUNNER_ID}" for the cloud sandbox`)
    .action(async (projectId: string, runnerIds: string[]) => {
      await (
        await getTrpcClient()
      ).projectWorkingDirectory.reorderExecutionEnvironments.mutate({
        order: runnerIds,
        projectId,
      });
      console.log(`${pc.green('✓')} Runner order updated`);
    });

  const env = project
    .command('env')
    .description('View or edit the environment every runner prepares');

  env
    .command('view <projectId>')
    .description('Show repositories, setup, variable names and run notes')
    .option('--json [fields]', 'Output JSON')
    .action(async (projectId: string, options: { json?: boolean | string }) => {
      const { data } = await (
        await getTrpcClient()
      ).projectWorkingDirectory.getEnvironment.query({ projectId });
      const configuration = data.configuration ?? {};
      // Variable names only: values stay where they are set.
      const view = {
        bootstrapCommand: configuration.bootstrapCommand,
        envNames: Object.keys(configuration.env ?? {}),
        id: data.id,
        notes: configuration.notes,
        repositories: (configuration.sources ?? []).filter((s: GitSource) => s.kind === 'git'),
      };
      if (options.json !== undefined) return outputJson(view, options.json);
      console.log(`\n${pc.bold('Repositories')}`);
      if (view.repositories.length === 0) console.log(pc.dim('  (none)'));
      for (const repository of view.repositories as GitSource[])
        console.log(
          `  - ${repository.url}${repository.ref ? pc.dim(` @${repository.ref}`) : ''}${repository.setupCommand ? pc.dim(`  setup: ${repository.setupCommand}`) : ''}`,
        );
      console.log(`\n${pc.bold('Setup')}\n  ${view.bootstrapCommand || pc.dim('(none)')}`);
      console.log(
        `\n${pc.bold('Variables')} ${pc.dim('(cloud sandbox only)')}\n  ${view.envNames.join(', ') || pc.dim('(none)')}`,
      );
      console.log(`\n${pc.bold('Run notes')}\n  ${view.notes || pc.dim('(none)')}`);
    });

  env
    .command('edit <projectId>')
    .description('Edit the environment; unspecified parts stay as they are')
    // Plain `<name...>` placeholders: commander reads `<url[@ref]...>` as a
    // single string, which turned every character into a repository.
    .option('--add-repo <repos...>', 'Add repositories, each as url or url@ref (branch or tag)')
    .option('--remove-repo <urls...>', 'Remove repositories')
    .option('--setup <command>', 'Set the setup command ("" clears it)')
    .option('--notes <text>', 'Set the run notes ("" clears them)')
    .action(
      async (
        projectId: string,
        options: { addRepo?: string[]; notes?: string; removeRepo?: string[]; setup?: string },
      ) => {
        const client = await getTrpcClient();
        const { data } = await client.projectWorkingDirectory.getEnvironment.query({ projectId });
        const configuration = { ...data.configuration };
        let sources = [...(configuration.sources ?? [])] as GitSource[];
        for (const url of options.removeRepo ?? [])
          sources = sources.filter((source) => !isRepository(source, url));
        for (const value of options.addRepo ?? []) {
          const { ref, url } = parseRepositoryArg(value);
          if (!sources.some((source) => isRepository(source, url)))
            sources.push({ kind: 'git', url, ...(ref && { ref }) });
        }
        const next = {
          ...configuration,
          sources,
          ...(options.setup !== undefined && { bootstrapCommand: options.setup || undefined }),
          ...(options.notes !== undefined && { notes: options.notes || undefined }),
        };
        await client.projectWorkingDirectory.updateEnvironment.mutate({
          configuration: next,
          projectId,
        });
        console.log(`${pc.green('✓')} Environment updated`);
      },
    );

  project
    .command('topic')
    .description("List a project's conversations")
    .command('list <projectId>')
    .option('--json [fields]', 'Output JSON')
    .action(async (projectId: string, options: { json?: boolean | string }) => {
      const { data } = await (
        await getTrpcClient()
      ).projectWorkingDirectory.listProjectTopics.query({ projectId });
      if (options.json !== undefined) return outputJson(data, options.json);
      if (data.length === 0) return console.log('No conversations found.');
      printTable(
        data.map((topic: { id: string; title?: string | null; updatedAt: Date | string }) => [
          topic.id,
          truncate(topic.title || '(untitled)', 48),
          timeAgo(topic.updatedAt),
        ]),
        ['ID', 'TITLE', 'UPDATED'],
      );
    });
}

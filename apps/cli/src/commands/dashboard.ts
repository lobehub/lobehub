import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { resolveWorkspaceId } from '../api/workspace';
import { outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';
import { resolveUrlBuilder, resourcePath, withUrl, withUrls } from './resourceUrl';
import { resolveAppUrlBuilder } from './task/url';

/** Where a board opens: inside its project when it belongs to one, else on the home dashboards. */
const dashboardPath = (dashboard: { id: string; projectId?: string | null }) =>
  dashboard.projectId
    ? `/project/${encodeURIComponent(dashboard.projectId)}/dashboard/${dashboard.id}`
    : `/dashboard/${dashboard.id}`;

export function registerDashboardCommand(program: Command) {
  const dashboard = program
    .command('dashboard')
    .description('Manage dashboards (boards of monitoring widgets)');

  dashboard
    .command('list')
    .description('List dashboards')
    .option('--project <projectId>', "Every board of a project, including its agents' boards")
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string; project?: string }) => {
      const client = await getTrpcClient();
      const { data } = options.project
        ? await client.dashboard.listByProject.query({ projectId: options.project })
        : await client.dashboard.list.query({});
      if (options.json !== undefined)
        return outputJson(
          withUrls(data, await resolveUrlBuilder(client), resourcePath.dashboard),
          options.json,
        );
      if (data.length === 0) return console.log('No dashboards found.');
      printTable(
        data.map((item) => [
          item.id,
          truncate(item.title, 40),
          item.projectId ?? '-',
          timeAgo(item.updatedAt),
        ]),
        ['ID', 'TITLE', 'PROJECT', 'UPDATED'],
      );
    });

  dashboard
    .command('view <id>')
    .description('View a dashboard and the widgets on it')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: boolean | string }) => {
      const client = await getTrpcClient();
      const { data } = await client.dashboard.detail.query({ id });
      if (options.json !== undefined)
        return outputJson(
          withUrl(data, await resolveUrlBuilder(client), resourcePath.dashboard(data)),
          options.json,
        );
      const buildUrl = await resolveAppUrlBuilder(client);
      console.log(`\n${pc.bold(data.title)} ${pc.dim(data.id)}`);
      if (data.description) console.log(data.description);
      console.log(`${pc.dim('URL:')} ${buildUrl(dashboardPath(data))}`);
      if (data.items.length === 0) return console.log('\nNo widgets on this board.');
      console.log();
      printTable(
        data.items.map(({ widget }) => [
          widget.id,
          truncate(widget.title, 40),
          widget.publishedVersionId ? 'live' : 'draft',
          widget.lastRunStatus ?? '-',
        ]),
        ['WIDGET', 'TITLE', 'STATE', 'LAST RUN'],
      );
    });

  dashboard
    .command('create')
    .description('Create a dashboard')
    .requiredOption('-t, --title <title>', 'Dashboard title')
    .option('-d, --description <text>', 'Description')
    .option('--project <projectId>', 'Create it inside a project (required in a workspace)')
    .option('--widget <widgetId>', 'Place this widget on the new board')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        description?: string;
        json?: boolean | string;
        project?: string;
        title: string;
        widget?: string;
      }) => {
        // Home dashboards are personal-only: a workspace-level board would be
        // created but have no page to open it on.
        if (resolveWorkspaceId() && !options.project) {
          log.error(
            'Workspace dashboards live inside a project: pass --project <projectId> (see `lh project list`).',
          );
          process.exitCode = 1;
          return;
        }
        const client = await getTrpcClient();
        const { data } = await client.dashboard.create.mutate({
          description: options.description,
          projectId: options.project,
          title: options.title,
          widgetId: options.widget,
        });
        if (options.json !== undefined)
          return outputJson(
            withUrl(data, await resolveUrlBuilder(client), resourcePath.dashboard(data)),
            options.json,
          );
        const buildUrl = await resolveAppUrlBuilder(client);
        console.log(`${pc.green('✓')} Created dashboard ${pc.bold(data.id)}`);
        console.log(`${pc.bold('dashboard')}: ${buildUrl(dashboardPath(data))}`);
      },
    );

  dashboard
    .command('add <dashboardId> <widgetId>')
    .description('Place a widget on a dashboard (an unpublished widget shows data once published)')
    .action(async (dashboardId: string, widgetId: string) => {
      await (await getTrpcClient()).dashboard.addItem.mutate({ dashboardId, widgetId });
      console.log(`${pc.green('✓')} Placed widget ${pc.bold(widgetId)} on ${pc.bold(dashboardId)}`);
    });
}

import { PROJECT_STATUSES, PROJECT_VISIBILITIES } from '@lobechat/types';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../utils/format';
import { log } from '../utils/logger';
import { resolveAppUrlBuilder } from './task/url';

const statusValues = PROJECT_STATUSES.join(', ');

export function registerProjectCommand(program: Command) {
  const project = program.command('project').description('Manage goal-oriented projects');

  project
    .command('list')
    .description('List projects')
    .option('--status <statuses...>', `Filter by status (${statusValues})`)
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { json?: boolean | string; status?: string[] }) => {
      const client = await getTrpcClient();
      const result = await client.project.list.query({
        statuses: options.status as (typeof PROJECT_STATUSES)[number][] | undefined,
      });
      if (options.json !== undefined) return outputJson(result.data, options.json);
      if (result.data.length === 0) return console.log('No projects found.');
      printTable(
        result.data.map((item) => [
          item.id,
          truncate(item.name, 40),
          item.status,
          item.visibility,
          timeAgo(item.updatedAt),
        ]),
        ['ID', 'NAME', 'STATUS', 'VISIBILITY', 'UPDATED'],
      );
    });

  project
    .command('view <id>')
    .description('View project detail')
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { json?: boolean | string }) => {
      const { data } = await (await getTrpcClient()).project.detail.query({ id });
      if (options.json !== undefined) return outputJson(data, options.json);
      console.log(`\n${pc.bold(data.project.name)} ${pc.dim(data.project.id)}`);
      console.log(`${pc.dim('Status:')} ${data.project.status}`);
      console.log(`${pc.dim('Visibility:')} ${data.project.visibility}`);
      if (data.project.description) console.log(`\n${data.project.description}`);
      console.log(
        `\n${data.agents?.length ?? 0} agent(s) · ${data.knowledgeBases?.length ?? 0} knowledge base(s) · ${data.tasks?.length ?? 0} task(s)`,
      );
    });

  project
    .command('create')
    .description('Create a project')
    .requiredOption('-i, --identifier <identifier>', 'Task identifier prefix (for example LOBE)')
    .requiredOption('-n, --name <name>', 'Project name')
    .option('-d, --description <description>', 'Description')
    .option('--slug <slug>', 'Project slug')
    .option('--visibility <visibility>', `Visibility (${PROJECT_VISIBILITIES.join(', ')})`)
    .action(
      async (options: {
        description?: string;
        identifier: string;
        name: string;
        slug?: string;
        visibility?: (typeof PROJECT_VISIBILITIES)[number];
      }) => {
        const client = await getTrpcClient();
        const buildUrl = await resolveAppUrlBuilder(client);
        const result = await client.project.create.mutate(options);
        const url = buildUrl(`/project/${encodeURIComponent(result.data.id)}`);
        console.log(`${pc.green('✓')} Created project ${pc.bold(result.data.id)}`);
        console.log(`${pc.bold('project')}: ${url}`);
      },
    );

  project
    .command('edit <id>')
    .description('Edit a project')
    .option('-n, --name <name>', 'Project name')
    .option('-d, --description <description>', 'Description')
    .option('--slug <slug>', 'Project slug')
    .option('--visibility <visibility>', `Visibility (${PROJECT_VISIBILITIES.join(', ')})`)
    .action(
      async (
        id: string,
        options: {
          description?: string;
          name?: string;
          slug?: string;
          visibility?: (typeof PROJECT_VISIBILITIES)[number];
        },
      ) => {
        await (await getTrpcClient()).project.update.mutate({ id, ...options });
        console.log(`${pc.green('✓')} Updated project ${pc.bold(id)}`);
      },
    );

  project
    .command('delete <id>')
    .description('Delete a project; tasks are retained without a project')
    .option('--yes', 'Skip confirmation')
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes && !(await confirm('Delete this project? Its tasks will be retained.')))
        return;
      await (await getTrpcClient()).project.delete.mutate({ id });
      console.log(`${pc.green('✓')} Deleted project ${pc.bold(id)}`);
    });

  project
    .command('status <id> <status>')
    .description(`Change project status (${statusValues}; reviewing/completed use review commands)`)
    .action(async (id: string, status: (typeof PROJECT_STATUSES)[number]) => {
      if (!PROJECT_STATUSES.includes(status) || ['completed', 'reviewing'].includes(status)) {
        log.error('Use request-review and accept to complete a project.');
        process.exitCode = 1;
        return;
      }
      await (
        await getTrpcClient()
      ).project.updateStatus.mutate({
        id,
        status: status as 'active' | 'archived' | 'backlog' | 'canceled' | 'paused',
      });
      console.log(`${pc.green('✓')} Project status changed to ${status}`);
    });

  const agent = project.command('agent').description('Manage project agents');
  agent
    .command('add <projectId> <agentId>')
    .option('--role <role>', 'Project-specific role')
    .option('--responsibility <text>', 'Project-specific responsibility')
    .action(
      async (
        projectId: string,
        agentId: string,
        options: { responsibility?: string; role?: string },
      ) => {
        await (
          await getTrpcClient()
        ).project.addAgent.mutate({ agentId, id: projectId, ...options });
        console.log(`${pc.green('✓')} Added agent ${pc.bold(agentId)}`);
      },
    );
  agent
    .command('remove <projectId> <agentId>')
    .action(async (projectId: string, agentId: string) => {
      await (await getTrpcClient()).project.removeAgent.mutate({ agentId, id: projectId });
      console.log(`${pc.green('✓')} Removed agent ${pc.bold(agentId)}`);
    });

  const kb = project.command('kb').description('Manage project knowledge bases');
  kb.command('add <projectId> <knowledgeBaseId>').action(
    async (projectId: string, knowledgeBaseId: string) => {
      await (
        await getTrpcClient()
      ).project.addKnowledgeBase.mutate({
        id: projectId,
        knowledgeBaseId,
      });
      console.log(`${pc.green('✓')} Added knowledge base ${pc.bold(knowledgeBaseId)}`);
    },
  );
  kb.command('remove <projectId> <knowledgeBaseId>').action(
    async (projectId: string, knowledgeBaseId: string) => {
      await (
        await getTrpcClient()
      ).project.removeKnowledgeBase.mutate({
        id: projectId,
        knowledgeBaseId,
      });
      console.log(`${pc.green('✓')} Removed knowledge base ${pc.bold(knowledgeBaseId)}`);
    },
  );

  const task = project.command('task').description('Manage project tasks');
  task
    .command('create <projectId>')
    .requiredOption('-i, --instruction <instruction>', 'Task instruction')
    .option('-n, --name <name>', 'Task name')
    .option('--agent <agentId>', 'Assignee agent ID')
    .option('--parent <taskId>', 'Parent task ID or identifier')
    .action(
      async (
        projectId: string,
        options: { agent?: string; instruction: string; name?: string; parent?: string },
      ) => {
        const client = await getTrpcClient();
        const buildUrl = await resolveAppUrlBuilder(client);
        const result = await client.task.create.mutate({
          assigneeAgentId: options.agent,
          instruction: options.instruction,
          name: options.name,
          parentTaskId: options.parent,
          projectId,
        });
        const url = buildUrl(`/task/${encodeURIComponent(result.data.identifier)}`);
        console.log(`${pc.green('✓')} Created task ${pc.bold(result.data.identifier)}`);
        console.log(`${pc.bold('task')}: ${url}`);
      },
    );
  task.command('move <projectId> <taskId>').action(async (projectId: string, taskId: string) => {
    const result = await (await getTrpcClient()).project.moveTask.mutate({ id: projectId, taskId });
    console.log(`${pc.green('✓')} Moved ${result.data.length} task(s)`);
  });

  project.command('request-review <id>').action(async (id: string) => {
    await (await getTrpcClient()).project.requestCompletion.mutate({ id });
    console.log(`${pc.green('✓')} Project is awaiting human review`);
  });
  project
    .command('accept <id>')
    .option('-m, --comment <comment>', 'Review comment')
    .action(async (id: string, options: { comment?: string }) => {
      await (await getTrpcClient()).project.acceptCompletion.mutate({ id, ...options });
      console.log(`${pc.green('✓')} Project completed`);
    });
  project
    .command('reject <id>')
    .requiredOption('-m, --comment <comment>', 'Rejection feedback')
    .action(async (id: string, options: { comment: string }) => {
      await (
        await getTrpcClient()
      ).project.rejectCompletion.mutate({ id, comment: options.comment });
      console.log(`${pc.green('✓')} Project returned to active`);
    });
  project.command('reopen <id>').action(async (id: string) => {
    await (await getTrpcClient()).project.reopen.mutate({ id });
    console.log(`${pc.green('✓')} Project reopened`);
  });
}

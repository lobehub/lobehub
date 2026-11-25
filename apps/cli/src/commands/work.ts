import path from 'node:path';

import type { Command } from 'commander';

import { getTrpcClient, type TrpcClient } from '../api/client';
import { outputJson, printTable } from '../utils/format';
import { uploadLocalFile } from '../utils/uploadLocalFile';
import { resolveUrlBuilder, resourcePath } from './resourceUrl';

interface LinkedTopic {
  agentId: string | null;
  groupId: string | null;
  title: string | null;
  topicId: string;
}

interface AgentWorkOptions {
  description?: string;
  file?: string;
  json?: boolean;
  operation?: string;
  title?: string;
  url?: string;
}

interface RegisteredWork {
  id: string;
  title: string;
  url?: string | null;
}

const requireOperationId = (options: AgentWorkOptions) => {
  const operationId = options.operation ?? process.env.LOBEHUB_OPERATION_ID;
  if (!operationId) {
    throw new Error(
      'lh work registers Works of a running agent: pass --operation or run it inside an agent run (LOBEHUB_OPERATION_ID)',
    );
  }
  return operationId;
};

/**
 * Upload a produced file as the run's own output. The `tool-result` source
 * keeps it out of the resource library, and is the source an operation token
 * may write.
 */
const uploadWorkFile = async (client: TrpcClient, filePath: string) => {
  const absolutePath = path.resolve(filePath);
  const file = (await uploadLocalFile(client, absolutePath, { source: 'tool-result' })) as {
    id: string;
  };
  return { absolutePath, fileId: file.id };
};

const printWork = (work: RegisteredWork, options: AgentWorkOptions, verb: string) => {
  if (options.json) outputJson(work);
  else console.log(`${verb} Work ${work.id}: ${work.title}`);
};

export function registerWorkCommand(program: Command) {
  const work = program
    .command('work')
    .description('Register the files and links this agent produced as Works, or look them up');

  work
    .command('create')
    .description(
      [
        'Register a file or link this agent produced as a Work card under its reply.',
        'Pass exactly one of --file or --url. Creating the same file path or link again in',
        'this conversation adds a new version. GitHub and Linear links are registered',
        'automatically when you create or edit them; do not pass them here.',
      ].join('\n'),
    )
    .option('--file <path>', 'Local file to upload and register')
    .option('--url <url>', 'http(s) link to register; requires --title')
    .option('--title <title>', 'Card title (defaults to the file name for --file)')
    .option('--description <text>', 'Card description')
    .option('--operation <id>', 'Defaults to LOBEHUB_OPERATION_ID')
    .option('--json', 'Output JSON')
    .action(async (options: AgentWorkOptions) => {
      if (Boolean(options.file) === Boolean(options.url)) {
        throw new Error('Pass exactly one of --file or --url');
      }
      if (options.url && !options.title) throw new Error('--title is required with --url');
      const operationId = requireOperationId(options);
      const client = await getTrpcClient();
      const text = { description: options.description, operationId, title: options.title };

      let created: RegisteredWork;
      if (options.url) {
        created = await client.work.createAgentWork.mutate({
          ...text,
          title: options.title!,
          type: 'link',
          url: options.url,
        });
      } else {
        const { absolutePath, fileId } = await uploadWorkFile(client, options.file!);
        created = await client.work.createAgentWork.mutate({
          ...text,
          fileId,
          filePath: absolutePath,
          type: 'file',
        });
      }
      printWork(created, options, 'Created');
    });

  work
    .command('update')
    .argument('<work-id>', 'Id of a Work this agent created with lh work create')
    .description(
      [
        'Add a version to a Work this agent created. Options left out keep their values.',
        'A link Work keeps its URL; register a new link with lh work create --url.',
        'Works registered automatically (GitHub, Linear, scanned files) cannot be updated.',
      ].join('\n'),
    )
    .option('--file <path>', 'New content for a file Work')
    .option('--title <title>', 'New card title')
    .option('--description <text>', 'New card description')
    .option('--operation <id>', 'Defaults to LOBEHUB_OPERATION_ID')
    .option('--json', 'Output JSON')
    .action(async (workId: string, options: AgentWorkOptions) => {
      if (!options.file && !options.title && options.description === undefined) {
        throw new Error('Pass at least one of --file, --title or --description');
      }
      const operationId = requireOperationId(options);
      const client = await getTrpcClient();
      const fileId = options.file ? (await uploadWorkFile(client, options.file)).fileId : undefined;

      const updated: RegisteredWork = await client.work.updateAgentWork.mutate({
        description: options.description,
        fileId,
        operationId,
        title: options.title,
        workId,
      });
      printWork(updated, options, 'Updated');
    });

  work
    .command('delete')
    .argument('<work-id>', 'Id of a Work this agent created with lh work create')
    .description(
      [
        'Delete a Work this agent created by mistake: its card and versions are removed,',
        'uploaded files stay. Works registered automatically cannot be deleted.',
      ].join('\n'),
    )
    .option('--operation <id>', 'Defaults to LOBEHUB_OPERATION_ID')
    .option('--json', 'Output JSON')
    .action(async (workId: string, options: AgentWorkOptions) => {
      const operationId = requireOperationId(options);
      const client = await getTrpcClient();
      const deleted: { id: string; title: string | null } =
        await client.work.deleteAgentWork.mutate({ operationId, workId });

      if (options.json) outputJson(deleted);
      else console.log(`Deleted Work ${deleted.id}${deleted.title ? `: ${deleted.title}` : ''}`);
    });

  work
    .command('lookup')
    .argument('<github-pr-url>', 'GitHub pull request URL')
    .description('Find all conversations linked to a GitHub pull request in the current workspace')
    .option('--json', 'Output JSON')
    .action(async (url: string, options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const { data }: { data: LinkedTopic[] } = await client.work.lookupPullRequest.query({ url });

      if (data.length === 0) {
        if (options.json) outputJson([]);
        else console.log('No linked conversations found in the current workspace.');
        return;
      }

      const toUrl = await resolveUrlBuilder(client);
      const topics = data.map((topic) => ({
        ...topic,
        url: toUrl(resourcePath.topic({ ...topic, id: topic.topicId })),
      }));

      if (options.json) outputJson(topics);
      else {
        printTable(
          topics.map((topic) => [topic.title || 'Untitled', topic.url || topic.topicId]),
          ['TITLE', 'CONVERSATION'],
        );
      }
    });
}

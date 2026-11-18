import fs from 'node:fs';

import { type ArtboardContent, formatArtboardResultLine } from '@lobechat/types';
import type { Command } from 'commander';

import { getTrpcClient } from '../api/client';
import { outputJson } from '../utils/format';
import { registerArtboardOpsCommand } from './artboardOps';
import { pushArtboardDir } from './artboardPush';
import { registerArtboardSkillCommand } from './artboardSkill';

interface BoardLike {
  content: ArtboardContent;
  id: string;
  revision: number;
}

const resultLine = (artboard: BoardLike) =>
  formatArtboardResultLine({
    boardCount: artboard.content.boards.length,
    groupCount: artboard.content.groups.length,
    id: artboard.id,
    revision: artboard.revision,
  });

const parseOps = (value?: string) => {
  if (value === undefined) return undefined;
  const text = value.startsWith('@') ? fs.readFileSync(value.slice(1), 'utf8') : value;
  const ops = JSON.parse(text);
  if (!Array.isArray(ops)) throw new Error('--ops must be a JSON array of ops');
  return ops;
};

const parseFiles = (value?: string) => {
  if (value === undefined) return undefined;
  const text = value.startsWith('@') ? fs.readFileSync(value.slice(1), 'utf8') : value;
  const files = JSON.parse(text);
  if (!files || typeof files !== 'object' || Array.isArray(files))
    throw new Error('--files must be a JSON object of writes, edits and deletes');
  return files;
};

const FILES_HELP =
  'File changes applied before the ops: {"writes":[{"path","content"}],"edits":[{"path","oldText","newText"}],"deletes":[path]} as JSON, or @file.json';

const positiveInteger = (value: string) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('Expected a positive integer');
  return result;
};

const topicId = () => process.env.LOBEHUB_TOPIC_ID || undefined;

export const registerArtboardCommand = (program: Command) => {
  const artboard = program
    .command('artboard')
    .description(
      'Lay out a requirement on a project artboard (same ops as the builtin-artboard tool)',
    );

  artboard
    .command('create')
    .description(
      "Create the artboard for a task; without --task it uses the run's conversation project",
    )
    .requiredOption('--title <title>', 'Board title')
    .option('--description <text>', 'One line shown on the board card')
    .option('--task <task>', 'Task id or identifier, such as PRJ-12')
    .option('--files <json>', FILES_HELP)
    .option(
      '--ops <json>',
      'Initial ops (addGroup, addBoard, addEdge, addRound, addPage, …) as a JSON array, or @file.json; shapes: lh artboard ops',
    )
    .option('--json', 'Print structured JSON')
    .action(
      async (options: {
        description?: string;
        files?: string;
        json?: boolean;
        ops?: string;
        task?: string;
        title: string;
      }) => {
        if (!options.task && !topicId())
          throw new Error('Pass --task: this shell has no LOBEHUB_TOPIC_ID to find the project');
        const client = await getTrpcClient();
        const result = await client.artboard.create.mutate({
          description: options.description,
          files: parseFiles(options.files),
          ops: parseOps(options.ops),
          taskId: options.task,
          title: options.title,
          topicId: topicId(),
        });
        if (options.json) return outputJson(result);
        console.log(resultLine(result.artboard));
      },
    );

  artboard
    .command('update <id>')
    .description('Apply file changes and ops; everything applies or nothing does')
    .requiredOption('--revision <n>', 'Revision you last read', positiveInteger)
    .option('--files <json>', FILES_HELP)
    .option(
      '--ops <json>',
      'Ops (add/update/remove Board, Group, Page; addRound, updateRound; addEdge, removeEdge; setCheck) as a JSON array, or @file.json; shapes: lh artboard ops',
    )
    .option('--json', 'Print structured JSON')
    .action(
      async (
        id: string,
        options: { files?: string; json?: boolean; ops?: string; revision: number },
      ) => {
        if (options.files === undefined && options.ops === undefined)
          throw new Error('Pass --ops, --files or both');
        const client = await getTrpcClient();
        const result = await client.artboard.update.mutate({
          files: parseFiles(options.files),
          id,
          ops: parseOps(options.ops),
          revision: options.revision,
        });
        if (options.json) return outputJson(result);
        console.log(resultLine(result.artboard));
      },
    );

  artboard
    .command('read <id>')
    .description('Print the artboard and its revision')
    .option('--json', 'Print structured JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const result = await client.artboard.read.query({ id });
      if (options.json) return outputJson(result);
      console.log(resultLine(result.artboard));
      console.log(JSON.stringify(result.artboard.content, null, 2));
    });

  artboard
    .command('push <id> <dir>')
    .description(
      'Upload the HTML pages, styles and images under <dir> as files of the artboard; unchanged files are skipped',
    )
    .option('--prune', 'Also delete artboard files that are not in <dir>')
    .option('--json', 'Print structured JSON')
    .action(async (id: string, dir: string, options: { json?: boolean; prune?: boolean }) => {
      const client = await getTrpcClient();
      const result = await pushArtboardDir(client.artboard, id, dir, { prune: options.prune });
      if (options.json) return outputJson(result);
      console.log(
        `pushed ${result.uploaded.length} · unchanged ${result.unchanged.length} · deleted ${result.deleted.length}`,
      );
      for (const skipped of result.skipped)
        console.log(`skipped ${skipped}: not a file a board can serve`);
    });

  artboard
    .command('files <id>')
    .description('List the files of the artboard')
    .option('--json', 'Print structured JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const files = await client.artboard.listFiles.query({ id });
      if (options.json) return outputJson(files);
      for (const file of files) console.log(`${file.path}  ${file.size} B`);
    });

  artboard
    .command('cat <id> <path>')
    .description('Print one text file of the artboard')
    .action(async (id: string, path: string) => {
      const client = await getTrpcClient();
      const file = await client.artboard.readFile.query({ id, path });
      if (file.content === undefined) throw new Error(`${file.path} is binary`);
      process.stdout.write(file.content);
    });

  artboard
    .command('list')
    .description("List the artboards in the run's project")
    .option('--task <task>', 'Find the project through this task instead')
    .option('--json', 'Print structured JSON')
    .action(async (options: { json?: boolean; task?: string }) => {
      const client = await getTrpcClient();
      const boards = await client.artboard.list.query({ taskId: options.task, topicId: topicId() });
      if (options.json) return outputJson(boards);
      for (const board of boards)
        console.log(`${board.id}  ${board.title}  ${board.phase}  revision ${board.revision}`);
    });
  registerArtboardOpsCommand(artboard);
  registerArtboardSkillCommand(artboard);
};

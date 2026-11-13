import fs from 'node:fs';

import { type ArtboardContent, formatArtboardResultLine } from '@lobechat/types';
import type { Command } from 'commander';

import { getTrpcClient } from '../api/client';
import { outputJson } from '../utils/format';

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
      'Lay out a requirement on a project artboard (same ops as the lobe-artboard tool)',
    );

  artboard
    .command('create')
    .description(
      "Create the artboard for a task; without --task it uses the run's conversation project",
    )
    .requiredOption('--title <title>', 'Board title')
    .option('--description <text>', 'One line shown on the board card')
    .option('--task <task>', 'Task id or identifier, such as PRJ-12')
    .option(
      '--ops <json>',
      'Initial ops (addGroup, addBoard, addEdge, addRound, addPage, …) as a JSON array, or @file.json',
    )
    .option('--json', 'Print structured JSON')
    .action(
      async (options: {
        description?: string;
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
    .description('Apply ops; every op applies or none does')
    .requiredOption('--revision <n>', 'Revision you last read', positiveInteger)
    .requiredOption(
      '--ops <json>',
      'Ops (add/update/remove Board, Group, Page; addRound, updateRound; addEdge, removeEdge; setCheck) as a JSON array, or @file.json',
    )
    .option('--json', 'Print structured JSON')
    .action(async (id: string, options: { json?: boolean; ops: string; revision: number }) => {
      const client = await getTrpcClient();
      const result = await client.artboard.update.mutate({
        id,
        ops: parseOps(options.ops)!,
        revision: options.revision,
      });
      if (options.json) return outputJson(result);
      console.log(resultLine(result.artboard));
    });

  artboard
    .command('read <id>')
    .description('Print the artboard, its revision, and boards behind their Canvas')
    .option('--json', 'Print structured JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const result = await client.artboard.read.query({ id });
      if (options.json) return outputJson(result);
      console.log(resultLine(result.artboard));
      for (const boardId of result.staleBoardIds)
        console.log(`stale board ${boardId}: its Canvas has a newer version`);
      console.log(JSON.stringify(result.artboard.content, null, 2));
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
};

import { readFile } from 'node:fs/promises';

import type { ArtifactBoardManifest } from '@lobechat/types';
import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { outputJson } from '../utils/format';

type JsonOption = boolean | string | undefined;

const printJson = (value: unknown, json: JsonOption) =>
  outputJson(value, typeof json === 'string' ? json : undefined);

/** What `board example` prints: two rounds, every option a pinned Canvas page. */
const EXAMPLE_MANIFEST: ArtifactBoardManifest = {
  description: 'Pick a direction first, then the detail.',
  rounds: [
    {
      id: 'direction',
      options: [
        {
          canvasId: '<canvasId>',
          canvasVersion: 1,
          id: 'a',
          label: 'A · dense list',
          reason: 'Fits the most rows above the fold.',
          recommended: true,
        },
        {
          canvasId: '<canvasId>',
          canvasVersion: 2,
          id: 'b',
          label: 'B · cards',
          page: 'cards.html',
          reason: 'Easier to scan when items carry images.',
        },
      ],
      title: 'Direction',
    },
    {
      id: 'detail',
      options: [
        {
          canvasId: '<canvasId>',
          canvasVersion: 3,
          id: 'a1',
          label: 'A1 · inline actions',
          reason: 'One click less per row.',
        },
      ],
      title: 'Detail',
    },
  ],
  title: 'Members page',
};

const describeBoard = (board: {
  boardId: string;
  choices: { chosenOptionId: string; roundId: string }[];
  manifest: ArtifactBoardManifest;
  title: string;
  version: number;
}) => {
  console.log(`${pc.bold(board.title)} ${pc.dim(`${board.boardId} · v${board.version}`)}`);
  board.manifest.rounds.forEach((round, index) => {
    const chosen = board.choices.find((choice) => choice.roundId === round.id)?.chosenOptionId;
    console.log(`  R${index + 1} ${round.title} ${pc.dim(`(${round.id})`)}`);
    for (const option of round.options) {
      const mark = option.id === chosen ? pc.green('●') : pc.dim('○');
      const tag = option.recommended ? pc.yellow(' ★') : '';
      console.log(
        `    ${mark} ${option.label}${tag} ${pc.dim(`${option.id} → ${option.canvasId}@${option.canvasVersion}${option.page ? `#${option.page}` : ''}`)}`,
      );
    }
  });
};

/**
 * Boards for agents: put Canvas versions side by side in rounds so a person
 * can pick one per round, then hand the picks to an acceptance as baseline
 * candidates. Options are Canvas references only — no HTML, no images.
 */
export function attachArtifactBoardCommands(artifact: Command) {
  const board = artifact
    .command('board')
    .description('Boards: rounds of Canvas options to pick from, publishable as acceptance frames');

  board
    .command('example')
    .description('Print a manifest template to fill in')
    .action(() => outputJson(EXAMPLE_MANIFEST));

  board
    .command('publish')
    .description(
      'Create a board from a manifest, or publish its next version with --board. ' +
        'Manifest: title, rounds[{id,title,options[{id,label,canvasId,canvasVersion,page?,recommended?,reason?}]}]. ' +
        'Image fields are rejected; every option must be a Canvas version you can open.',
    )
    .requiredOption('--file <path>', 'Manifest JSON (see `lh artifact board example`)')
    .option('--board <boardId>', 'Publish a new version of this board')
    .option('--topic <topicId>', 'Show the board among this topic’s works')
    .option('--agent <agentId>', 'Agent that produced the board')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (options: {
        agent?: string;
        board?: string;
        file: string;
        json?: JsonOption;
        topic?: string;
      }) => {
        const manifest = JSON.parse(await readFile(options.file, 'utf8')) as ArtifactBoardManifest;
        const client = await getTrpcClient();
        const result = await client.artifactBoard.publish.mutate({
          boardId: options.board,
          context:
            options.topic || options.agent
              ? { agentId: options.agent, topicId: options.topic }
              : undefined,
          manifest,
        });
        if (options.json !== undefined) return printJson(result, options.json);
        console.log(`${pc.green('✓')} Published board ${pc.bold(result.boardId)}`);
        describeBoard(result);
      },
    );

  board
    .command('view <boardId>')
    .description('Print the rounds, options and the pick of each round')
    .option('--version <n>', 'An earlier manifest version', (value) => Number.parseInt(value, 10))
    .option('--json [fields]', 'Output JSON')
    .action(async (boardId: string, options: { json?: JsonOption; version?: number }) => {
      const client = await getTrpcClient();
      const result = await client.artifactBoard.get.query({ boardId, version: options.version });
      if (!result) throw new Error(`Board ${boardId} not found`);
      if (options.json !== undefined) return printJson(result, options.json);
      describeBoard(result);
    });

  board
    .command('choose <boardId>')
    .description('Record the option picked in one round')
    .requiredOption('--round <roundId>', 'Round id')
    .requiredOption('--option <optionId>', 'Option id')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (boardId: string, options: { json?: JsonOption; option: string; round: string }) => {
        const client = await getTrpcClient();
        const result = await client.artifactBoard.choose.mutate({
          boardId,
          optionId: options.option,
          roundId: options.round,
        });
        if (options.json !== undefined) return printJson(result, options.json);
        describeBoard(result);
      },
    );

  board
    .command('frames <boardId>')
    .description(
      'Print the picks as the JSON `lh acceptance frames publish --file` reads: ' +
        'one frame, each round’s pick a version, the latest first',
    )
    .action(async (boardId: string) => {
      const client = await getTrpcClient();
      outputJson(await client.artifactBoard.toFrames.query({ boardId }));
    });

  board
    .command('to-acceptance <boardId>')
    .description(
      'Publish the picks onto an acceptance as frame candidates; the latest pick becomes ' +
        'the baseline candidate. Other frames and locked baselines are kept.',
    )
    .requiredOption('--acceptance <acceptanceId>', 'Acceptance id')
    .option('--json [fields]', 'Output JSON')
    .action(async (boardId: string, options: { acceptance: string; json?: JsonOption }) => {
      const client = await getTrpcClient();
      const result = await client.acceptance.publishBoardCandidates.mutate({
        boardId,
        id: options.acceptance,
      });
      if (options.json !== undefined) return printJson(result, options.json);
      const frame = result.board.frames.find((item) => item.key === result.frameKey);
      console.log(
        `${pc.green('✓')} Frame ${pc.bold(result.frameKey)} now has ${frame?.versions.length ?? 0} candidate versions (board version ${result.board.version})`,
      );
    });
}

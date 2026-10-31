import { readFile } from 'node:fs/promises';

import type { Command } from 'commander';
import pc from 'picocolors';

import type { TrpcClient } from '../../api/client';
import { getTrpcClient } from '../../api/client';
import { outputJson } from '../../utils/format';
import { uploadLocalFile } from '../../utils/uploadLocalFile';

/** A version is a Canvas page; product screenshots go through `frames capture` instead. */
interface FrameVersionFile {
  canvasId: string;
  /** The Canvas version to pin, so later edits to the Canvas do not move the reference. */
  canvasVersion: number;
  label: string;
  note?: string;
  /** The page inside the Canvas, e.g. `members.html`; the Canvas entry when absent. */
  page?: string;
}

interface FrameBoardFile {
  description?: string;
  expectedVersion?: number;
  frames: {
    criteria?: { copy?: string[]; edgeCases?: string[]; states?: string[] };
    description?: string;
    key: string;
    title: string;
    versions: FrameVersionFile[];
  }[];
  title: string;
  transitions: { from: string; to: string; trigger: string }[];
}

const uploadImage = async (client: TrpcClient, filePath: string) => {
  const file = await uploadLocalFile(client, filePath);
  if (!file?.id) throw new Error(`Upload returned no file id for ${filePath}`);
  return file.id as string;
};

/**
 * Agent entry point for the frames board: publish Canvas pages as each node's
 * reference (always labelled mock) for design review, then pin real product
 * captures beside the locked baselines. Choosing versions and locking baselines is the reviewers'
 * act on the acceptance page.
 */
export function attachAcceptanceFramesCommands(acceptance: Command) {
  const frames = acceptance
    .command('frames')
    .description('Frames board: Canvas references for design review, real captures for delivery');

  frames
    .command('publish <acceptanceId>')
    .description(
      'Publish or revise the board. Each version is a Canvas page ' +
        '(`canvasId`, `canvasVersion`, optional `page`), never an image: screenshots of the ' +
        'product go through `frames capture` once a baseline is locked. Transitions name ' +
        'frames by `key`. Review state survives for frames whose key stays.',
    )
    .requiredOption(
      '--file <path>',
      'JSON: title, frames[{key,title,versions[{canvasId,canvasVersion,page,label}],criteria}], transitions',
    )
    .option('--json [fields]', 'Output JSON')
    .action(async (id: string, options: { file: string; json?: boolean | string }) => {
      const client = await getTrpcClient();
      const source = JSON.parse(await readFile(options.file, 'utf8')) as FrameBoardFile;

      const framesInput = (source.frames ?? []).map((frame) => ({
        ...frame,
        versions: (frame.versions ?? []).map((version) => {
          if (!version.canvasId || !Number.isInteger(version.canvasVersion))
            throw new Error(
              `Frame "${frame.key}" version "${version.label}" needs a canvasId and canvasVersion`,
            );
          return {
            canvasId: version.canvasId,
            canvasVersion: version.canvasVersion,
            label: version.label,
            note: version.note,
            page: version.page,
          };
        }),
      }));

      const board = await client.acceptance.publishFrameBoard.mutate({
        board: {
          description: source.description,
          frames: framesInput,
          title: source.title,
          transitions: source.transitions ?? [],
        },
        expectedVersion: source.expectedVersion,
        id,
      });
      if (options.json !== undefined) {
        outputJson(board, typeof options.json === 'string' ? options.json : undefined);
        return;
      }
      console.log(
        `${pc.green('✓')} Published ${pc.bold(board.title)} — ${board.frames.length} frames, ` +
          `${board.transitions.length} transitions (version ${board.version})`,
      );
    });

  frames
    .command('view <acceptanceId>')
    .description('Print the board: frames, chosen versions, baselines and real captures')
    .action(async (id: string) => {
      const client = await getTrpcClient();
      outputJson(await client.acceptance.getFrameBoard.query({ id }));
    });

  frames
    .command('capture <acceptanceId>')
    .description('Pin a real product capture beside a locked baseline (always labelled real)')
    .requiredOption('--frame <key>', 'Frame key, e.g. `members`')
    .requiredOption('--file <path>', 'Screenshot of the running product')
    .option('--note <text>', 'Where and how it was captured')
    .option('--json [fields]', 'Output JSON')
    .action(
      async (
        id: string,
        options: { file: string; frame: string; json?: boolean | string; note?: string },
      ) => {
        const client = await getTrpcClient();
        const current = await client.acceptance.getFrameBoard.query({ id });
        const frame = current?.frames.find(
          (item) => item.key === options.frame || item.id === options.frame,
        );
        if (!frame) throw new Error(`No frame "${options.frame}" on this board`);
        const fileId = await uploadImage(client, options.file);
        const board = await client.acceptance.updateFrame.mutate({
          frameId: frame.id,
          id,
          operation: { fileId, note: options.note, type: 'addCapture' },
        });
        if (options.json !== undefined) {
          outputJson(board, typeof options.json === 'string' ? options.json : undefined);
          return;
        }
        console.log(`${pc.green('✓')} Attached a real capture to ${pc.bold(frame.title)}`);
      },
    );
}

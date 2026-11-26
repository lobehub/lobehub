import { readFile } from 'node:fs/promises';
import { buffer } from 'node:stream/consumers';

import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../api/client';
import { outputJson } from '../utils/format';
import { log } from '../utils/logger';

const fail = (message: string): never => {
  log.error(message);
  process.exit(1);
};

/**
 * The A2UI messages in a card file: the operations array itself, or renderUI's arguments
 * (`{ "operations": [...] }`).
 */
export const parseCardFile = (text: string): unknown => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`The card file is not valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'operations' in parsed)
    return (parsed as { operations: unknown }).operations;
  return parsed;
};

/**
 * Operation-scoped, like `lh channel`: a card is drawn for the current Agent run's reply, with
 * the run's own token, and posted with that reply.
 */
export const registerCardCommand = (program: Command) => {
  const card = program
    .command('card')
    .description('Draw A2UI cards that are posted with the current Agent run’s Channel reply');

  card
    .command('guide')
    .description(
      'Print the card-drawing guide: when a card helps and an index of its components; with --components, their full schemas and examples',
    )
    .option(
      '-c, --components <names>',
      'Comma-separated component or function names, e.g. Chart,Table',
    )
    .option('--json', 'Print structured JSON')
    .action(async (options: { components?: string; json?: boolean }) => {
      const components = options.components
        ?.split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      const client = await getTrpcClient();
      const result = await client.channel.cardGuide.query(
        components?.length ? { components } : undefined,
      );
      if (options.json) return outputJson(result);
      console.log(result.guide);
    });

  card
    .command('render')
    .description(
      'Validate a card and draw it for your reply; the same surfaceId again replaces it. Invalid cards print the errors to fix',
    )
    .requiredOption(
      '-f, --file <path>',
      'JSON file with the A2UI 1.0 messages for one surface (renderUI operations); - reads stdin',
    )
    .option('--json', 'Print structured JSON')
    .action(async (options: { file: string; json?: boolean }) => {
      let text: string;
      try {
        text =
          options.file === '-'
            ? (await buffer(process.stdin)).toString('utf8')
            : await readFile(options.file, 'utf8');
      } catch (error) {
        return fail(`Cannot read ${options.file}: ${(error as Error).message}`);
      }
      let operations: unknown;
      try {
        operations = parseCardFile(text);
      } catch (error) {
        return fail((error as Error).message);
      }

      const client = await getTrpcClient();
      const result = await client.channel.renderCard.mutate({ operations });
      if (options.json) outputJson(result);
      else if (result.ok) console.log(`${pc.green('✓')} ${result.message}`);
      else log.error(result.message);
      if (!result.ok) process.exit(1);
    });
};

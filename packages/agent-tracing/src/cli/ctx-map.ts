import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Command } from 'commander';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';

import { buildContextMap } from '../analysis/contextMap';
import { renderContextMap } from '../viewer/contextMap';
import { renderContextMapHtml } from '../viewer/contextMapHtml';
import { resolveSnapshot } from './resolve';

const red = (s: string) => `\x1B[31m${s}\x1B[39m`;
const dim = (s: string) => `\x1B[2m${s}\x1B[22m`;

/** Context window of the model the operation ran on, preferring the matching provider. */
function resolveContextWindow(model?: string, provider?: string): number | undefined {
  if (!model) return undefined;
  const matches = LOBE_DEFAULT_MODEL_LIST.filter((m) => m.id === model);
  const exact = matches.find((m) => m.providerId === provider);
  return (exact ?? matches[0])?.contextWindowTokens ?? undefined;
}

export function registerCtxMapCommand(program: Command) {
  program
    .command('ctx-map')
    .alias('cm')
    .alias('map')
    .description('Map the context window composition of every LLM call in an operation')
    .argument('[target]', 'operation id, trace id, snapshot json path, or `latest`')
    .option('--html [path]', 'write a standalone HTML report instead of terminal output')
    .option('-w, --width <n>', 'track width in terminal columns')
    .option('--window <n>', 'override the model context window used as the track')
    .option('--full-window', 'always scale the track to the full context window')
    .option('-j, --json', 'JSON output (per-call segments + cache stats)')
    .action(
      async (
        target: string | undefined,
        opts: {
          fullWindow?: boolean;
          html?: boolean | string;
          json?: boolean;
          width?: string;
          window?: string;
        },
      ) => {
        const snapshot = await resolveSnapshot(target);
        if (!snapshot) {
          console.error(
            red(
              `Snapshot not found${target ? ` for ${target}` : ''} (fetch remote traces first via \`agent-tracing inspect\`)`,
            ),
          );
          process.exit(1);
        }

        const override = opts.window ? Number.parseInt(opts.window, 10) : undefined;
        const map = buildContextMap(snapshot, {
          contextWindowTokens:
            override && !Number.isNaN(override)
              ? override
              : resolveContextWindow(snapshot.model, snapshot.provider),
        });

        if (opts.json) {
          console.log(JSON.stringify(map, null, 2));
          return;
        }

        if (opts.html) {
          const target =
            typeof opts.html === 'string'
              ? opts.html
              : path.join('.agent-tracing', '_reports', `ctx-map_${snapshot.operationId}.html`);
          await mkdir(path.dirname(path.resolve(target)), { recursive: true });
          await writeFile(
            target,
            renderContextMapHtml(map, { fullWindow: opts.fullWindow }),
            'utf8',
          );
          console.log(`ctx-map report written to ${target}`);
          console.log(dim(`open file://${path.resolve(target)}`));
          return;
        }

        const width = opts.width ? Number.parseInt(opts.width, 10) : undefined;
        console.log(
          renderContextMap(map, {
            fullWindow: opts.fullWindow,
            width: width && !Number.isNaN(width) ? width : undefined,
          }),
        );
      },
    );
}

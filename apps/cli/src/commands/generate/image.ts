import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';

const collectParam = (value: string, previous: string[]) => [...previous, value];

/**
 * Parse repeated `--param key=value` flags. Values are read as JSON when possible so numbers,
 * booleans and arrays keep their type (`steps=30`, `promptExtend=true`); anything else, such as
 * `size=1024x1024` or `aspectRatio=16:9`, stays a string.
 */
export const parseImageParams = (entries: string[]): Record<string, unknown> => {
  const params: Record<string, unknown> = {};

  for (const entry of entries) {
    const separator = entry.indexOf('=');
    if (separator <= 0) throw new Error(`Invalid --param "${entry}": expected key=value`);

    const key = entry.slice(0, separator).trim();
    const raw = entry.slice(separator + 1);
    try {
      params[key] = JSON.parse(raw);
    } catch {
      params[key] = raw;
    }
  }

  return params;
};

const formatSchemaValue = (definition: Record<string, unknown>) => {
  const parts: string[] = [];
  if (Array.isArray(definition.enum)) parts.push(definition.enum.join(' | '));
  if (typeof definition.min === 'number' || typeof definition.max === 'number') {
    parts.push(`${definition.min ?? ''}..${definition.max ?? ''}`);
  }
  if (definition.default !== undefined) parts.push(`default ${JSON.stringify(definition.default)}`);
  return parts.join(', ');
};

export function registerImageCommand(parent: Command) {
  parent
    .command('image <prompt>')
    .description('Generate an image from text')
    .option('-m, --model <model>', 'Model ID', 'dall-e-3')
    .option('-p, --provider <provider>', 'Provider name', 'openai')
    .option('-n, --num <n>', 'Number of images', '1')
    .option(
      '--param <key=value>',
      'Model parameter, repeatable (e.g. --param size=1024x1024). See "lh generate image-params"',
      collectParam,
      [],
    )
    .option('--width <px>', 'Width in pixels (shortcut for --param width=<px>)')
    .option('--height <px>', 'Height in pixels (shortcut for --param height=<px>)')
    .option('--steps <n>', 'Number of steps (shortcut for --param steps=<n>)')
    .option('--seed <n>', 'Random seed (shortcut for --param seed=<n>)')
    .option('--json', 'Output raw JSON')
    .action(
      async (
        prompt: string,
        options: {
          height?: string;
          json?: boolean;
          model: string;
          num: string;
          param: string[];
          provider: string;
          seed?: string;
          steps?: string;
          width?: string;
        },
      ) => {
        // An empty prompt is always rejected upstream; fail before creating a topic and
        // charging for a request that cannot succeed (e.g. `$(cat missing-file)`).
        if (!prompt.trim()) {
          log.error('Prompt is empty. Pass the image description as the first argument.');
          process.exit(1);
          return;
        }

        let extraParams: Record<string, unknown>;
        try {
          extraParams = parseImageParams(options.param);
        } catch (error) {
          log.error((error as Error).message);
          process.exit(1);
          return;
        }

        const client = await getTrpcClient();

        // Create a generation topic first
        const topicId = await client.generationTopic.createTopic.mutate({ type: 'image' });

        const params: { prompt: string } & Record<string, any> = { ...extraParams, prompt };
        if (options.width) params.width = Number.parseInt(options.width, 10);
        if (options.height) params.height = Number.parseInt(options.height, 10);
        if (options.steps) params.steps = Number.parseInt(options.steps, 10);
        if (options.seed) params.seed = Number.parseInt(options.seed, 10);

        const result = await client.image.createImage.mutate({
          generationTopicId: topicId as string,
          imageNum: Number.parseInt(options.num, 10),
          model: options.model,
          params,
          provider: options.provider,
        });

        const r = result as any;
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
          return;
        }

        const data = r.data || r;
        console.log(`${pc.green('✓')} Image generation started`);
        if (data.batch?.id) console.log(`  Batch ID: ${pc.bold(data.batch.id)}`);

        const generations = data.generations || [];
        if (generations.length > 0) {
          console.log(`  ${generations.length} image(s) queued`);
          for (const gen of generations) {
            if (gen.asyncTaskId) {
              console.log(`  Generation ${pc.bold(gen.id)} → Task ${pc.dim(gen.asyncTaskId)}`);
            }
          }
          console.log();
          console.log(
            pc.dim('Use "lh generate status <generationId> <taskId>" to check progress.'),
          );
        }
      },
    );

  parent
    .command('image-params')
    .description('Show the parameters an image model accepts')
    .requiredOption('-m, --model <model>', 'Model ID')
    .requiredOption('-p, --provider <provider>', 'Provider name')
    .option('--json', 'Output raw JSON')
    .action(async (options: { json?: boolean; model: string; provider: string }) => {
      const client = await getTrpcClient();
      const models = (await client.aiModel.getAiProviderModelList.query({
        id: options.provider,
        type: 'image',
      })) as Array<{ id: string; parameters?: Record<string, Record<string, unknown>> }>;
      const model = models.find((item) => item.id === options.model);

      if (!model) {
        log.error(`Image model not found: ${options.provider}/${options.model}`);
        process.exit(1);
        return;
      }

      const parameters = model.parameters ?? {};
      if (options.json) {
        console.log(JSON.stringify(parameters, null, 2));
        return;
      }

      const keys = Object.keys(parameters).filter((key) => key !== 'prompt');
      if (keys.length === 0) {
        console.log(`${options.provider}/${options.model} declares no parameters besides prompt.`);
        return;
      }

      console.log(`Parameters for ${pc.bold(`${options.provider}/${options.model}`)}:`);
      for (const key of keys) {
        const detail = formatSchemaValue(parameters[key] ?? {});
        console.log(`  ${pc.bold(key)}${detail ? `  ${pc.dim(detail)}` : ''}`);
      }
      console.log();
      console.log(pc.dim('Pass them with --param, e.g. --param size=1024x1024.'));
    });
}

import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';

export function registerImageCommand(parent: Command) {
  parent
    .command('image <prompt>')
    .description('Generate an image from text')
    .option('-m, --model <model>', 'Model ID', 'dall-e-3')
    .option('-p, --provider <provider>', 'Provider name', 'openai')
    .option('-n, --num <n>', 'Number of images', '1')
    .option('--width <px>', 'Width in pixels')
    .option('--height <px>', 'Height in pixels')
    .option('--steps <n>', 'Number of steps')
    .option('--seed <n>', 'Random seed')
    .option('--json', 'Output raw JSON')
    .action(
      async (
        prompt: string,
        options: {
          height?: string;
          json?: boolean;
          model: string;
          num: string;
          provider: string;
          seed?: string;
          steps?: string;
          width?: string;
        },
      ) => {
        const client = await getTrpcClient();

        // Create a generation topic first
        const topicId = await client.generationTopic.createTopic.mutate({ type: 'image' });

        const params: { prompt: string } & Record<string, any> = { prompt };
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
}

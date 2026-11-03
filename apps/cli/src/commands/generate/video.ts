import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';

export function registerVideoCommand(parent: Command) {
  parent
    .command('video <prompt>')
    .description('Generate a video from text or image(s)')
    .requiredOption('-m, --model <model>', 'Model ID')
    .requiredOption('-p, --provider <provider>', 'Provider name')
    .option('--aspect-ratio <ratio>', 'Aspect ratio (e.g. 16:9)')
    .option('--duration <sec>', 'Duration in seconds')
    .option('--resolution <res>', 'Resolution (e.g. 720p, 1080p)')
    .option('--seed <n>', 'Random seed')
    .option('--image <url>', 'First-frame image URL (image-to-video)')
    .option('--images <urls...>', 'Multiple reference image URLs')
    .option('--end-image <url>', 'Last-frame image URL')
    .option('--json', 'Output raw JSON')
    .action(
      async (
        prompt: string,
        options: {
          aspectRatio?: string;
          duration?: string;
          endImage?: string;
          image?: string;
          images?: string[];
          json?: boolean;
          model: string;
          provider: string;
          resolution?: string;
          seed?: string;
        },
      ) => {
        const client = await getTrpcClient();
        const topicId = await client.generationTopic.createTopic.mutate({ type: 'video' });

        const params: { prompt: string } & Record<string, any> = { prompt };
        if (options.aspectRatio) params.aspectRatio = options.aspectRatio;
        if (options.duration) params.duration = Number.parseInt(options.duration, 10);
        if (options.resolution) params.resolution = options.resolution;
        if (options.seed) params.seed = Number.parseInt(options.seed, 10);
        if (options.image) params.imageUrl = options.image;
        if (options.images && options.images.length > 0) params.imageUrls = options.images;
        if (options.endImage) params.endImageUrl = options.endImage;

        const result = await client.video.createVideo.mutate({
          generationTopicId: topicId as string,
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
        console.log(`${pc.green('✓')} Video generation started`);
        if (data.batch?.id) console.log(`  Batch ID: ${pc.bold(data.batch.id)}`);

        const generations = data.generations || [];
        if (generations.length > 0) {
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

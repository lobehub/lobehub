import type { Command } from 'commander';

import { getTrpcClient } from '../api/client';
import { log } from '../utils/logger';

/** Extract the share id from a `.../share/t/<id>[/llm.txt]` URL. */
export const parseShareTopicUrl = (input: string): string | undefined => {
  try {
    const match = new URL(input.trim()).pathname.match(/\/share\/t\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
};

export function registerReadCommand(program: Command) {
  program
    .command('read <url>')
    .description(
      'Read a LobeHub link as plain text via the API (e.g. a shared topic: https://lobehub.com/share/t/<id>), bypassing the Cloudflare-protected web page',
    )
    .option('--json', 'Output JSON ({ title, text })')
    .action(async (url: string, options: { json?: boolean }) => {
      const shareId = parseShareTopicUrl(url);
      if (!shareId) {
        log.error(
          `Unsupported link "${url}". Supported: shared topic (https://lobehub.com/share/t/<id>).`,
        );
        process.exit(1);
        return;
      }

      const client = await getTrpcClient();
      const { text, title } = await client.share.getSharedTopicText.query({ shareId });

      if (options.json) {
        console.log(JSON.stringify({ text, title }, null, 2));
        return;
      }

      // Same layout as the web `share/t/:id/llm.txt` route.
      console.log([title ? `# ${title}` : '', text].filter(Boolean).join('\n\n'));
    });
}

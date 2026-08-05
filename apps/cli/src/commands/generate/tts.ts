import { writeFileSync } from 'node:fs';

import type { Command } from 'commander';
import pc from 'picocolors';

import { getAuthInfo } from '../../api/http';
import { log } from '../../utils/logger';

export function registerTtsCommand(parent: Command) {
  parent
    .command('tts <text>')
    .description('Convert text to speech')
    .option('-o, --output <file>', 'Output audio file path', 'output.mp3')
    .option('--voice <voice>', 'Voice name', 'alloy')
    .option('--speed <n>', 'Speed multiplier (0.25-4.0)', '1')
    .option('--model <model>', 'TTS model', 'tts-1')
    .action(
      async (
        text: string,
        options: {
          model: string;
          output: string;
          speed: string;
          voice: string;
        },
      ) => {
        const { serverUrl, headers } = await getAuthInfo();

        const payload: Record<string, any> = {
          input: text,
          model: options.model,
          options: {
            model: options.model,
            voice: options.voice,
          },
          speed: Number.parseFloat(options.speed),
          voice: options.voice,
        };

        const res = await fetch(`${serverUrl}/webapi/tts/openai`, {
          body: JSON.stringify(payload),
          headers,
          method: 'POST',
        });

        if (!res.ok) {
          const errText = await res.text();
          log.error(`TTS failed: ${res.status} ${errText}`);
          process.exit(1);
          return;
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        writeFileSync(options.output, buffer);
        console.log(
          `${pc.green('✓')} Audio saved to ${pc.bold(options.output)} (${Math.round(buffer.length / 1024)}KB)`,
        );
      },
    );
}

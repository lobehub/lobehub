import { writeFile } from 'node:fs/promises';

import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';

interface TtsCommandOptions {
  emotion?: string;
  format?: string;
  instructions?: string;
  model: string;
  output?: string;
  params?: string;
  pitch?: string;
  provider?: string;
  sampleRate?: string;
  speed?: string;
  voice?: string;
  volume?: string;
}

const parseNumber = (name: string, value: string | undefined) => {
  if (value === undefined) return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number, got "${value}"`);

  return parsed;
};

/**
 * Merge `--params` JSON with the dedicated flags; a dedicated flag wins over the same key
 * in the JSON.
 */
export const buildTtsParams = (options: TtsCommandOptions): Record<string, unknown> => {
  let base: Record<string, unknown> = {};
  if (options.params) {
    try {
      base = JSON.parse(options.params);
    } catch {
      throw new Error('--params must be a JSON object, e.g. \'{"speed":1.2,"emotion":"happy"}\'');
    }
    if (!base || typeof base !== 'object' || Array.isArray(base)) {
      throw new Error('--params must be a JSON object');
    }
  }

  const flags: Record<string, unknown> = {
    emotion: options.emotion,
    format: options.format,
    instructions: options.instructions,
    pitch: parseNumber('pitch', options.pitch),
    sampleRate: parseNumber('sample-rate', options.sampleRate),
    speed: parseNumber('speed', options.speed),
    volume: parseNumber('volume', options.volume),
  };

  return {
    ...base,
    ...Object.fromEntries(Object.entries(flags).filter(([, value]) => value !== undefined)),
  };
};

export function registerTtsCommand(parent: Command) {
  parent
    .command('tts <text>')
    .description('Convert text to speech')
    .option('-o, --output <file>', 'Output audio file path (default: output.<format>)')
    .option('--voice <voice>', "Voice id (default: the model's default voice)")
    .option('--speed <n>', 'Speed multiplier')
    .option('--pitch <n>', 'Pitch adjustment')
    .option('--volume <n>', 'Volume adjustment')
    .option('--emotion <emotion>', 'Emotion, e.g. happy, sad')
    .option('--format <format>', 'Audio format: mp3, opus, aac')
    .option('--sample-rate <hz>', 'Output sample rate in Hz')
    .option('--instructions <text>', 'Style instructions, for models that accept them')
    .option('--params <json>', 'Extra standard TTS params as a JSON object')
    .option('-m, --model <model>', 'Model ID (provider/model format)', 'tts-1')
    .option('-p, --provider <provider>', 'Provider name (derived from model if omitted)')
    .action(async (text: string, options: TtsCommandOptions) => {
      const parts = options.model.split('/');
      const provider = options.provider || (parts.length > 1 ? parts[0] : 'openai');
      const model = parts.length > 1 ? parts.slice(1).join('/') : options.model;

      let params: Record<string, unknown>;
      try {
        params = buildTtsParams(options);
      } catch (error) {
        log.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
        return;
      }

      const client = await getTrpcClient();
      type SynthesizeParams = Parameters<typeof client.tts.synthesize.mutate>[0]['params'];
      // The server validates the values against the model's declared params.
      const result = await client.tts.synthesize.mutate({
        input: text,
        model,
        params: Object.keys(params).length > 0 ? (params as SynthesizeParams) : undefined,
        provider,
        voice: options.voice,
      });

      // Servers that predate standard TTS params return no `format`; they always sent mp3.
      const output = options.output || `output.${result.format ?? 'mp3'}`;
      const buffer = Buffer.from(result.audioBase64, 'base64');
      await writeFile(output, buffer);

      const usage = result.usage;
      const usageText = [
        usage?.inputCharacters !== undefined && `${usage.inputCharacters} chars`,
        usage?.totalTokens !== undefined && `${usage.totalTokens} tokens`,
        usage?.cost !== undefined && `$${usage.cost}`,
      ]
        .filter(Boolean)
        .join(', ');

      console.log(
        `${pc.green('✓')} Audio saved to ${pc.bold(output)} (${Math.round(buffer.length / 1024)}KB${usageText ? `, ${usageText}` : ''})`,
      );
    });
}

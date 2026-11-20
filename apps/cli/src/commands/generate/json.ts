import { readFile } from 'node:fs/promises';

import type { StructureOutputParams } from '@lobechat/types';
import type { Command } from 'commander';

import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';

type StructuredSchema = NonNullable<StructureOutputParams['schema']>;

/**
 * Root keywords the server keeps (`StructureSchema` in `@lobechat/types`). It
 * drops everything else, so a schema relying on `allOf` or `minProperties`
 * would be silently weakened.
 */
const SUPPORTED_SCHEMA_KEYS = new Set([
  '$defs',
  '$schema',
  'additionalProperties',
  'description',
  'properties',
  'required',
  'title',
  'type',
]);

export function registerJsonCommand(parent: Command) {
  parent
    .command('json <prompt>')
    .description('Generate a JSON object with an LLM (structured output, single completion)')
    .option('-m, --model <model>', 'Model ID (provider/model format)', 'openai/gpt-4o-mini')
    .option('-p, --provider <provider>', 'Provider name (derived from model if omitted)')
    .option('-s, --system <prompt>', 'System prompt')
    .option(
      '--schema <schema>',
      'JSON Schema for the reply — inline JSON or a path to a .json file (required)',
    )
    .option('--schema-name <name>', 'Schema name sent to the model', 'response')
    .option('--strict', 'Require the model to adhere strictly to the schema')
    .option('--pipe', 'Pipe mode: read additional context from stdin')
    .action(
      async (
        prompt: string,
        options: {
          model: string;
          pipe?: boolean;
          provider?: string;
          schema?: string;
          schemaName?: string;
          strict?: boolean;
          system?: string;
        },
      ) => {
        // `-m provider/model` only splits off a provider when `-p` is absent; with an
        // explicit provider the model ID keeps its own slashes (Qwen/Qwen3.6-27B).
        const [head, ...tail] = options.model.split('/');
        const providerFromModel = !options.provider && tail.length > 0;
        const provider = options.provider || (providerFromModel ? head : 'openai');
        const model = providerFromModel ? tail.join('/') : options.model;

        const resolved = await resolveSchema(options);
        if ('error' in resolved) {
          log.error(resolved.error);
          process.exit(1);
          return;
        }

        // Read additional input from stdin if --pipe
        let fullPrompt = prompt;
        if (options.pipe) {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk as Buffer);
          }
          const stdinContent = Buffer.concat(chunks).toString('utf8').trim();
          if (stdinContent) {
            fullPrompt = `${prompt}\n\n${stdinContent}`;
          }
        }

        const messages: Array<{ content: string; role: string }> = [];
        if (options.system) {
          messages.push({ content: options.system, role: 'system' });
        }
        messages.push({ content: fullPrompt, role: 'user' });

        // Structured output runs through the `aiChat.outputJSON` mutation rather
        // than `/webapi/chat`: the server owns the provider-specific handling
        // (`json_schema` support, the tool-calling fallback, Responses API
        // routing) and hands back the parsed object.
        const client = await getTrpcClient();

        let result: { data?: unknown };
        try {
          result = await client.aiChat.outputJSON.mutate({
            messages,
            model,
            provider,
            schema: resolved.value,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error(`JSON generation failed: ${message}`);
          process.exit(1);
          return;
        }

        // Schema mode resolves an unparsable reply (prose, truncated JSON) to
        // `undefined` instead of throwing, so a missing payload is a failure.
        if (result.data === undefined) {
          log.error('The model reply was not valid JSON for the given schema.');
          process.exit(1);
          return;
        }

        console.log(JSON.stringify(result.data, null, 2));
      },
    );
}

/**
 * Build the schema sent to the server. `--schema` is required: the endpoint has
 * no schema-less mode, and a permissive object schema would break the strict
 * paths (Responses API models force `strict: true`).
 */
async function resolveSchema(options: {
  schema?: string;
  schemaName?: string;
  strict?: boolean;
}): Promise<{ error: string } | { value: StructuredSchema }> {
  if (!options.schema) {
    return { error: '`--schema` is required: pass a JSON Schema inline or as a .json file.' };
  }

  const parsed = await readSchema(options.schema);
  if ('error' in parsed) return parsed;

  return {
    value: {
      name: options.schemaName || 'response',
      schema: parsed.value,
      ...(options.strict ? { strict: true } : {}),
    },
  };
}

/** `--schema` accepts inline JSON, a `.json` path, or an `@`-prefixed path. */
async function readSchema(
  raw: string,
): Promise<{ error: string } | { value: StructuredSchema['schema'] }> {
  const trimmed = raw.trim();
  let text = trimmed;

  if (!trimmed.startsWith('{')) {
    const filePath = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
    try {
      text = await readFile(filePath, 'utf8');
    } catch {
      return {
        error: `Cannot read schema file "${filePath}". Pass inline JSON or a readable path.`,
      };
    }
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'The value passed to --schema is not valid JSON.' };
  }

  if (!isObjectSchema(value)) {
    return { error: 'The schema must be an object schema with a `properties` object.' };
  }

  const unsupported = Object.keys(value).filter((key) => !SUPPORTED_SCHEMA_KEYS.has(key));

  if (unsupported.length > 0) {
    return {
      error: `The schema uses keywords the server drops: ${unsupported.join(', ')}. Supported root keywords: ${[...SUPPORTED_SCHEMA_KEYS].join(', ')}.`,
    };
  }

  return { value };
}

function isObjectSchema(value: unknown): value is StructuredSchema['schema'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const candidate = value as Record<string, unknown>;

  return (
    candidate.type === 'object' &&
    typeof candidate.properties === 'object' &&
    candidate.properties !== null &&
    !Array.isArray(candidate.properties)
  );
}

import { readFile } from 'node:fs/promises';

import type { Command } from 'commander';

import type { TrpcClient } from '../../api/client';
import { getTrpcClient } from '../../api/client';
import { log } from '../../utils/logger';

type DecideInput = Parameters<TrpcClient['aiChat']['decide']['mutate']>[0];

const QUESTION_TYPES = new Set(['boolean', 'choice', 'score']);

export function registerDecideCommand(parent: Command) {
  parent
    .command('decide [state]')
    .description(
      'Ask a decision model typed questions about one state (answers come back as probabilities)',
    )
    .option(
      '-m, --model <model>',
      'Decision model ID (provider/model format), e.g. lobehub/jev-1.14.0 (required)',
    )
    .option('-p, --provider <provider>', 'Provider name (derived from model if omitted)')
    .option(
      '-q, --questions <questions>',
      'Question name → question, as inline JSON or a path to a .json file (required). ' +
        'Each question is {"type":"boolean"|"choice"|"score","instructions":...,"criteria":...}',
    )
    .option('--state-file <path>', 'Read the state from a file instead of the argument')
    .option('--pipe', 'Pipe mode: read the state (or more of it) from stdin')
    .action(
      async (
        stateArg: string | undefined,
        options: {
          model?: string;
          pipe?: boolean;
          provider?: string;
          questions?: string;
          stateFile?: string;
        },
      ) => {
        if (!options.model) {
          log.error('`--model` is required: pass a decision model, e.g. lobehub/jev-1.14.0.');
          process.exit(1);
          return;
        }

        // `-m provider/model` only splits off a provider when `-p` is absent, as in `gen json`.
        const [head, ...tail] = options.model.split('/');
        const providerFromModel = !options.provider && tail.length > 0;
        const provider = options.provider || (providerFromModel ? head : 'openai');
        const model = providerFromModel ? tail.join('/') : options.model;

        const questions = await readQuestions(options.questions);
        if ('error' in questions) {
          log.error(questions.error);
          process.exit(1);
          return;
        }

        const state = await readState(stateArg, options);
        if ('error' in state) {
          log.error(state.error);
          process.exit(1);
          return;
        }

        const client = await getTrpcClient();

        let result: { data: unknown };
        try {
          result = await client.aiChat.decide.mutate({
            metadata: { trigger: 'cli' },
            model,
            provider,
            // Shape checked loosely here; the server validates every question.
            questions: questions.value as DecideInput['questions'],
            state: state.value,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error(`Decision failed: ${message}`);
          process.exit(1);
          return;
        }

        console.log(JSON.stringify(result.data, null, 2));
      },
    );
}

/** Inline JSON (starts with `{`), a `.json` path, or an `@`-prefixed path. */
async function readJsonArg(
  raw: string,
  flag: string,
): Promise<{ error: string } | { value: unknown }> {
  const trimmed = raw.trim();
  let text = trimmed;

  if (!trimmed.startsWith('{')) {
    const filePath = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
    try {
      text = await readFile(filePath, 'utf8');
    } catch {
      return {
        error: `Cannot read ${flag} file "${filePath}". Pass inline JSON or a readable path.`,
      };
    }
  }

  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: `The value passed to ${flag} is not valid JSON.` };
  }
}

async function readQuestions(
  raw: string | undefined,
): Promise<{ error: string } | { value: Record<string, unknown> }> {
  if (!raw) {
    return { error: '`--questions` is required: pass the questions inline or as a .json file.' };
  }

  const parsed = await readJsonArg(raw, '--questions');
  if ('error' in parsed) return parsed;

  const { value } = parsed;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: '`--questions` must be an object of question name → question.' };
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return { error: '`--questions` needs at least one question.' };

  for (const [name, question] of entries) {
    const type = (question as { type?: unknown } | null)?.type;
    if (typeof type !== 'string' || !QUESTION_TYPES.has(type)) {
      return {
        error: `Question "${name}" needs a type of ${[...QUESTION_TYPES].join(', ')}.`,
      };
    }
    if ((question as { instructions?: unknown }).instructions === undefined) {
      return { error: `Question "${name}" needs instructions.` };
    }
  }

  return { value: value as Record<string, unknown> };
}

async function readState(
  stateArg: string | undefined,
  options: { pipe?: boolean; stateFile?: string },
): Promise<{ error: string } | { value: string }> {
  let state = stateArg ?? '';

  if (options.stateFile) {
    try {
      state = await readFile(options.stateFile, 'utf8');
    } catch {
      return { error: `Cannot read state file "${options.stateFile}".` };
    }
  }

  if (options.pipe) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const stdinContent = Buffer.concat(chunks).toString('utf8').trim();
    if (stdinContent) state = state ? `${state}\n\n${stdinContent}` : stdinContent;
  }

  if (!state.trim()) {
    return { error: 'No state: pass it as an argument, with --state-file, or with --pipe.' };
  }

  return { value: state };
}

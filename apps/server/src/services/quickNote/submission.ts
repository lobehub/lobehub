import {
  QuickNoteApiName,
  QuickNoteIdentifier,
  QuickNoteManifest,
} from '@lobechat/builtin-tool-quick-note';
import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type { ChatCompletionTool, GenerateObjectSchema } from '@lobechat/model-runtime';
import { type QuickNoteRunError, RequestTrigger } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { agentOperations, messagePlugins, messages } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import type { AiGenerationService } from '@/server/services/aiGeneration';

import { extractQuickNoteOutputJson, validateQuickNoteSubmission } from './generation';
import { isToolCapabilityError } from './toolCapability';

const log = debug('lobe-server:quick-note:submission');

/**
 * Completion reasons after which a run that never submitted still gets one forced submit call:
 * the run finished or hit a step cap. A cost cap must not spend more, and errors or interrupts
 * have nothing worth projecting.
 */
const FORCED_SUBMIT_REASONS = new Set(['done', 'max_steps', 'tool_call_repeat_limit']);

/** The run transcript handed to the forced submit call is bounded to keep its cost predictable. */
const TRANSCRIPT_PROMPT_MAX_CHARS = 30_000;
const TRANSCRIPT_ENTRY_MAX_CHARS = 4000;
const TRANSCRIPT_MAX_CHARS = 60_000;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * Reads the arguments of the latest successful `submitResult` call in a Run's Topic.
 *
 * Use when:
 * - A Quick Note follow-up run completed; its output is the submit tool call, not the text.
 *
 * Returns:
 * - The parsed arguments, or `undefined` when the run never submitted successfully.
 */
export const findQuickNoteSubmission = async (
  db: LobeChatDatabase,
  userId: string,
  topicId: string,
): Promise<unknown> => {
  const rows = await db
    .select({ arguments: messagePlugins.arguments })
    .from(messagePlugins)
    .innerJoin(messages, eq(messages.id, messagePlugins.id))
    .where(
      and(
        eq(messages.topicId, topicId),
        eq(messages.userId, userId),
        eq(messagePlugins.identifier, QuickNoteIdentifier),
        eq(messagePlugins.apiName, QuickNoteApiName.submitResult),
        isNull(messagePlugins.error),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(5);

  // A rejected call keeps its error; still re-check, since rows written before validation existed
  // or by a misbehaving runtime must not become the Run's output.
  for (const row of rows) {
    const args = row.arguments ? parseJson(row.arguments) : undefined;
    if (args !== undefined && !validateQuickNoteSubmission(args)) return args;
  }
  return undefined;
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]` : text;

/**
 * Renders a Run's Topic as a plain-text work log for the forced submit call.
 *
 * Tool calls and results are flattened to text, so the call carries no tool-call history that a
 * provider could reject for missing pairs. The first user message (the note and its context) is
 * kept; the most recent work wins the remaining budget.
 */
export const loadQuickNoteRunTranscript = async (
  db: LobeChatDatabase,
  userId: string,
  topicId: string,
): Promise<string> => {
  const rows = await db
    .select({
      apiName: messagePlugins.apiName,
      content: messages.content,
      identifier: messagePlugins.identifier,
      role: messages.role,
      tools: messages.tools,
    })
    .from(messages)
    .leftJoin(messagePlugins, eq(messagePlugins.id, messages.id))
    .where(and(eq(messages.topicId, topicId), eq(messages.userId, userId)))
    .orderBy(asc(messages.createdAt));

  const entries = rows.flatMap((row) => {
    const content = row.content?.trim() ?? '';
    if (row.role === 'tool') {
      const name = [row.identifier, row.apiName].filter(Boolean).join('/');
      return [`[tool result ${name}]\n${clip(content, TRANSCRIPT_ENTRY_MAX_CHARS)}`];
    }
    if (row.role === 'assistant') {
      const calls = Array.isArray(row.tools)
        ? row.tools
            .filter(isRecord)
            .map((tool) =>
              [tool.identifier, tool.apiName].filter((part) => typeof part === 'string').join('/'),
            )
            .filter(Boolean)
        : [];
      const parts = [
        content && clip(content, TRANSCRIPT_ENTRY_MAX_CHARS),
        calls.length > 0 && `(called ${calls.join(', ')})`,
      ].filter(Boolean);
      return parts.length > 0 ? [`[assistant]\n${parts.join('\n')}`] : [];
    }
    if (row.role === 'user' && content) return [`[user]\n${content}`];
    return [];
  });

  const [first, ...rest] = entries;
  if (!first) return '';

  const head = clip(first, TRANSCRIPT_PROMPT_MAX_CHARS);
  const kept: string[] = [];
  let budget = TRANSCRIPT_MAX_CHARS - head.length;
  for (const entry of rest.toReversed()) {
    if (entry.length > budget) break;
    kept.unshift(entry);
    budget -= entry.length;
  }
  const skipped = rest.length - kept.length;

  return [head, ...(skipped > 0 ? [`…[${skipped} earlier entries omitted]`] : []), ...kept].join(
    '\n\n',
  );
};

/** The forced submit call failed to produce acceptable arguments. */
export class QuickNoteSubmissionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'QuickNoteSubmissionError';
  }
}

const submitApi = QuickNoteManifest.api.find(({ name }) => name === QuickNoteApiName.submitResult)!;

const submitTool: ChatCompletionTool = {
  function: {
    description: submitApi.description,
    name: submitApi.name,
    parameters: submitApi.parameters,
  },
  type: 'function',
};

const submitSchema: GenerateObjectSchema = {
  description: submitApi.description,
  name: submitApi.name,
  schema: submitApi.parameters as GenerateObjectSchema['schema'],
};

/** Pulls the `submitResult` arguments out of a tool-call list, an object, or JSON text. */
const extractSubmitArguments = (result: unknown): unknown => {
  if (Array.isArray(result)) {
    const calls = result.filter(isRecord);
    const call = calls.find((item) => item.name === submitApi.name) ?? calls[0];
    if (!call) return undefined;
    return typeof call.arguments === 'string' ? parseJson(call.arguments) : call.arguments;
  }
  if (typeof result === 'string') return parseJson(result.trim());
  return result ?? undefined;
};

type GenerationMode = 'json_schema' | 'tool_choice';

export interface ForceQuickNoteSubmissionParams {
  generator: Pick<AiGenerationService, 'generateObject'>;
  /** The follow-up run's instructions (protocol plus plan), so the forced call asks for the same output. */
  instructions: string;
  model: string;
  provider: string;
  signal?: AbortSignal;
  tracing: TracingOptions;
  /** The run's work log from {@link loadQuickNoteRunTranscript}. */
  transcript: string;
  trigger: RequestTrigger;
}

/**
 * Makes the `submitResult` call a run that ended without one.
 *
 * Use when:
 * - A Quick Note follow-up run stopped (step limit, or a text answer) before submitting.
 *
 * Expects:
 * - One forced function call on the run's model; when the model or route cannot force a tool
 *   call, it retries in JSON-schema mode. Output that fails validation is retried once in the
 *   same mode. Provider failures (auth, quota, network) propagate unchanged.
 *
 * Returns:
 * - Validated `submitResult` arguments.
 *
 * Throws:
 * - {@link QuickNoteSubmissionError} when no acceptable arguments came back.
 */
export const forceQuickNoteSubmission = async ({
  generator,
  instructions,
  model,
  provider,
  signal,
  tracing,
  transcript,
  trigger,
}: ForceQuickNoteSubmissionParams): Promise<unknown> => {
  const messages = [
    { content: instructions, role: 'system' as const },
    {
      content: [
        'The Quick Note run recorded below ended before it called submitResult.',
        'Do not continue the work. Using only this record, call submitResult now with the complete output.',
        '',
        '<run_transcript>',
        transcript,
        '</run_transcript>',
      ].join('\n'),
      role: 'user' as const,
    },
  ];

  const generate = async (mode: GenerationMode) =>
    extractSubmitArguments(
      await generator.generateObject(
        {
          messages,
          model,
          provider,
          ...(mode === 'tool_choice' ? { tools: [submitTool] } : { schema: submitSchema }),
        },
        {
          metadata: { trigger },
          signal,
          tracing: {
            ...tracing,
            metadata: { ...tracing.metadata, submitMode: mode },
            schemaName: submitApi.name,
          } satisfies TracingOptions,
        },
      ),
    );

  let mode: GenerationMode = 'tool_choice';
  let output: unknown;
  try {
    output = await generate(mode);
  } catch (error) {
    if (signal?.aborted || !isToolCapabilityError(error)) throw error;
    log('forced submit unsupported, falling back to JSON schema: %O', error);
  }
  if (output === undefined) {
    mode = 'json_schema';
    output = await generate(mode);
  }

  let invalid = validateQuickNoteSubmission(output);
  if (invalid) {
    log('%s submit failed validation, retrying once: %s', mode, invalid);
    output = await generate(mode);
    invalid = validateQuickNoteSubmission(output);
  }
  if (invalid) throw new QuickNoteSubmissionError(`Forced submit failed validation: ${invalid}`);

  return output;
};

export type QuickNoteRunOutputResolution =
  | { output: unknown; status: 'ok' }
  | { error: QuickNoteRunError; retryable: boolean; status: 'failed' }
  /** The Run already ended; a duplicate callback has nothing to do. */
  | { status: 'skipped' };

export interface ResolveQuickNoteRunOutputParams {
  completion: {
    errorMessage?: string;
    lastAssistantContent?: string;
    reason: string;
    runId: string;
  };
  db: LobeChatDatabase;
  generator: Pick<AiGenerationService, 'generateObject'>;
  /** The run's instructions, built only when a forced call is needed. */
  instructions: () => string;
  run: { operationId?: string | null; status: string; topicId?: string | null };
  userId: string;
}

/**
 * Finds the output of a finished Quick Note follow-up run.
 *
 * Use when:
 * - The run's completion callback fires, before projecting the output onto the Run.
 *
 * Expects:
 * - Sources are tried in order: the last successful `submitResult` call, JSON in the final text
 *   answer, then one forced `submitResult` call on the run's model over its transcript (only after
 *   `done` or a step cap).
 *
 * Returns:
 * - The raw output, or the failure to record. Unreadable output is not retryable; a provider
 *   failure during the forced call, or a run that ended without output, is.
 */
export const resolveQuickNoteRunOutput = async ({
  completion,
  db,
  generator,
  instructions,
  run,
  userId,
}: ResolveQuickNoteRunOutputParams): Promise<QuickNoteRunOutputResolution> => {
  const operation = run.operationId
    ? (
        await db
          .select({
            model: agentOperations.model,
            provider: agentOperations.provider,
            topicId: agentOperations.topicId,
          })
          .from(agentOperations)
          .where(eq(agentOperations.id, run.operationId))
          .limit(1)
      )[0]
    : undefined;
  const topicId = run.topicId ?? operation?.topicId ?? undefined;

  const submitted = topicId ? await findQuickNoteSubmission(db, userId, topicId) : undefined;
  if (submitted !== undefined) return { output: submitted, status: 'ok' };

  if (completion.lastAssistantContent?.trim()) {
    const fromText = extractQuickNoteOutputJson(completion.lastAssistantContent);
    if (fromText !== undefined && !validateQuickNoteSubmission(fromText)) {
      return { output: fromText, status: 'ok' };
    }
  }

  // A duplicate callback for a Run that already ended must not pay for another call.
  if (run.status !== 'pending' && run.status !== 'running') return { status: 'skipped' };

  const model = operation?.model;
  const provider = operation?.provider;
  if (!FORCED_SUBMIT_REASONS.has(completion.reason) || !topicId || !model || !provider) {
    // The Agent answered but its text cannot be read; re-running the same note would most
    // likely fail the same way, so the sweep must not retry it automatically.
    if (completion.reason === 'done' && completion.lastAssistantContent?.trim()) {
      return {
        error: {
          code: 'projection_failed',
          message: 'Quick Note output must be a submitResult call or a JSON object',
        },
        retryable: false,
        status: 'failed',
      };
    }
    return {
      error: {
        code: 'no_accepted_output',
        message:
          completion.errorMessage ||
          `Agent completed without accepted output (${completion.reason})`,
        reason: completion.reason,
      },
      retryable: true,
      status: 'failed',
    };
  }

  try {
    const output = await forceQuickNoteSubmission({
      generator,
      instructions: instructions(),
      model,
      provider,
      tracing: {
        metadata: {
          operationId: run.operationId,
          reason: completion.reason,
          runId: completion.runId,
        },
        scenario: TRACING_SCENARIOS.QuickNoteSubmit,
        topicId,
      },
      transcript: await loadQuickNoteRunTranscript(db, userId, topicId),
      trigger: RequestTrigger.QuickNote,
    });
    return { output, status: 'ok' };
  } catch (error) {
    // The model answered twice and neither answer was usable: not retryable, as above.
    if (error instanceof QuickNoteSubmissionError) {
      return {
        error: { code: 'projection_failed', message: error.message },
        retryable: false,
        status: 'failed',
      };
    }
    // Provider failures (auth, quota, network) say nothing about the note; keep it retryable.
    console.error('[QuickNote] forced submit failed for run %s:', completion.runId, error);
    return {
      error: {
        code: 'no_accepted_output',
        message: error instanceof Error ? error.message : 'Forced submit failed',
        reason: completion.reason,
      },
      retryable: true,
      status: 'failed',
    };
  }
};

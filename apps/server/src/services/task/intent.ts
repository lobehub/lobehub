import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import {
  chainTaskIntent,
  TASK_INTENT_JSON_SCHEMA,
  TASK_INTENT_PROMPT_VERSION,
} from '@lobechat/prompts';
import type { TaskIntentAnalysis } from '@lobechat/types';
import debug from 'debug';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { resolveGoalModelConfig } from '@/server/services/goal/modelConfig';

const log = debug('lobe-server:task-intent');

const MAX_CLARIFICATIONS = 3;

const analysisSchema = z.object({
  clarifications: z
    .array(
      z.object({
        impact: z.string().optional(),
        options: z.array(z.string()).optional(),
        question: z.string().min(1),
      }),
    )
    .optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  kind: z.enum(['task', 'goal']).optional(),
  kindReason: z.string().optional(),
  refinedInstruction: z.string().min(1),
  summary: z.string().min(1),
  title: z.string().min(1),
});

/**
 * Read the raw text typed into the task composer and report what it means.
 *
 * The surface used to derive a task name by truncating the first line at 30
 * characters and hand the text straight to an agent, so a request that was
 * missing the one detail that decides the deliverable only surfaced as a wrong
 * result an autonomous run later. This service is the step in between: it
 * names the task, restates the outcome for the user to check, flags the
 * questions whose answers change the work, and says whether the request is
 * really a standing goal rather than a single task.
 *
 * It answers only — the caller decides whether to create straight through or
 * stop for confirmation, and nothing here writes to the database.
 */
export class TaskIntentService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  async analyze(params: { context?: string; instruction: string }): Promise<TaskIntentAnalysis> {
    // Intent reading is the same "structure the user's request" model role as
    // goal criteria drafting, so it rides that assignment rather than adding a
    // configurable model slot for a feature still behind a lab toggle.
    const modelConfig = await resolveGoalModelConfig(this.db, this.userId);
    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);

    const raw = await ai.generateObject(
      {
        ...chainTaskIntent(params),
        ...modelConfig,
        schema: TASK_INTENT_JSON_SCHEMA,
        thinking: { type: 'disabled' },
      },
      {
        metadata: { trigger: 'task_intent' },
        tracing: {
          promptVersion: TASK_INTENT_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.TaskIntent,
          schemaName: TASK_INTENT_JSON_SCHEMA.name,
        } satisfies TracingOptions,
      },
    );

    const parsed = analysisSchema.safeParse(raw);
    if (!parsed.success) {
      log('task intent did not match schema: %O', parsed.error.flatten());
      throw new Error('Task intent analysis did not match the expected shape.');
    }

    return normalizeIntent(parsed.data, params.instruction);
  }
}

type RawIntent = z.infer<typeof analysisSchema>;

/**
 * Bring a well-formed but over-eager answer back to something the composer can
 * act on. Exported for tests: the gate that decides whether the user is
 * interrupted reads `confidence` and `clarifications`, so the two must not be
 * allowed to contradict each other.
 */
export const normalizeIntent = (raw: RawIntent, instruction: string): TaskIntentAnalysis => {
  const clarifications = (raw.clarifications ?? [])
    .filter((item) => item.question.trim())
    .slice(0, MAX_CLARIFICATIONS)
    .map((item) => ({
      impact: item.impact?.trim() || undefined,
      options: item.options?.map((option) => option.trim()).filter(Boolean),
      question: item.question.trim(),
    }));

  // A model that asks a question has, by its own account, found something it
  // could not determine. Letting it also claim high confidence would send the
  // request straight through and drop the question on the floor.
  const claimed = raw.confidence ?? 'medium';
  const confidence = clarifications.length > 0 && claimed === 'high' ? 'medium' : claimed;

  return {
    clarifications,
    confidence,
    kind: raw.kind ?? 'task',
    kindReason: raw.kindReason?.trim() || undefined,
    refinedInstruction: raw.refinedInstruction.trim() || instruction,
    summary: raw.summary.trim(),
    title: raw.title.trim(),
  };
};

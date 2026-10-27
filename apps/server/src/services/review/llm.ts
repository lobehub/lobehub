import { RequestTrigger } from '@lobechat/types';
import type { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { resolveVerifyModelConfig } from '@/server/services/verify/modelConfig';

import { buildGenerateObjectSchema } from './schema';

export interface ReviewLlmRequest {
  /** Prompt version recorded in tracing. */
  promptVersion: string;
  /** Tracing scenario, e.g. `document_review_check`. */
  scenario: string;
  /** JSON schema name; also the zod root type name. */
  schema: z.ZodTypeAny;
  schemaName: string;
  system: string;
  user: string;
}

/**
 * The single LLM dependency of the review service. Tests inject a scripted
 * implementation; production uses {@link AiReviewLlm}.
 */
export interface ReviewLlm {
  generateObject: (request: ReviewLlmRequest) => Promise<unknown>;
}

/**
 * Production adapter. Resolves the same provider/model chain Verify uses, so
 * review runs on a configured, runnable model instead of an arbitrary chat
 * model, and disables thinking to keep structured output snappy.
 */
export class AiReviewLlm implements ReviewLlm {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  async generateObject(request: ReviewLlmRequest): Promise<unknown> {
    const modelConfig = await resolveVerifyModelConfig(this.db, this.userId, {}, this.workspaceId);
    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);

    return ai.generateObject(
      {
        messages: [
          { content: request.system, role: 'system' },
          { content: request.user, role: 'user' },
        ],
        model: modelConfig.model,
        provider: modelConfig.provider,
        schema: buildGenerateObjectSchema(request.schema, { name: request.schemaName }),
        thinking: { type: 'disabled' },
      },
      {
        // Rule proposals, checklist runs and fix suggestions are document-review
        // work: tag them like impact analysis so spend is not booked as Verify.
        metadata: { trigger: RequestTrigger.DocumentReview },
        tracing: {
          promptVersion: request.promptVersion,
          schemaName: request.schemaName,
          scenario: request.scenario,
        },
      },
    );
  }
}

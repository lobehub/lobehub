import type { GenerateObjectSchema } from '@lobechat/model-runtime';
import { DOCUMENT_REVIEW_IMPACT_JSON_SCHEMA } from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';
import { resolveVerifyModelConfig } from '@/server/services/verify/modelConfig';

export interface DocumentImpactLlmRequest {
  /** Prompt version recorded on the tracing row. */
  promptVersion: string;
  /** Tracing scenario, `document_review_impact`. */
  scenario: string;
  schemaName: string;
  system: string;
  user: string;
}

/**
 * The only LLM dependency of the analysis. Tests inject a scripted
 * implementation; production uses {@link AiDocumentImpactLlm}.
 */
export interface DocumentImpactLlm {
  generateObject: (request: DocumentImpactLlmRequest) => Promise<unknown>;
}

/**
 * Production adapter. Resolves the same provider/model chain Verify uses, so
 * the analysis runs on a configured, runnable model instead of inheriting
 * whatever chat model happened to open the document.
 */
export class AiDocumentImpactLlm implements DocumentImpactLlm {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  async generateObject(request: DocumentImpactLlmRequest): Promise<unknown> {
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
        schema: DOCUMENT_REVIEW_IMPACT_JSON_SCHEMA as unknown as GenerateObjectSchema,
        thinking: { type: 'disabled' },
      },
      {
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

import type { LobeChatDatabase } from '@/database/type';

import { AiDocumentImpactLlm } from './llm';
import { DrizzleImpactRepository } from './repository';
import { DocumentReviewImpactService } from './service';

export * from './diff';
export * from './errors';
export * from './llm';
export * from './repository';
export * from './schema';
export * from './service';
export * from './text';

/** Production wiring: Drizzle-backed repository plus the Verify model policy. */
export const createDocumentReviewImpactService = (params: {
  db: LobeChatDatabase;
  userId: string;
  workspaceId: string;
}): DocumentReviewImpactService =>
  new DocumentReviewImpactService({
    llm: new AiDocumentImpactLlm(params.db, params.userId, params.workspaceId),
    repository: new DrizzleImpactRepository(params.db, params.userId, params.workspaceId),
  });

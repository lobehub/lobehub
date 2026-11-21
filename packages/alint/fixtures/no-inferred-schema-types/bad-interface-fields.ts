// Fixture: a service result type is carved out of the persona tables.
import type { UserPersonaExtractionResult } from '@lobechat/memory-user-memory';

import type { userPersonaDocumentHistories, userPersonaDocuments } from '@/database/schemas';

export interface UserPersonaAgentResult {
  agentResult: UserPersonaExtractionResult;
  // alint-expect
  diff?: typeof userPersonaDocumentHistories.$inferSelect;
  // alint-expect
  document: typeof userPersonaDocuments.$inferSelect;
}

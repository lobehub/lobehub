/* eslint-disable sort-keys-fix/sort-keys-fix , typescript-sort-keys/interface */
import { GroundingSearch } from '../../search';
import { MessageMetadata, ModelReasoning } from '../common';

export interface DBMessageItem {
  id: string;

  role: string;
  content: string;
  reasoning: ModelReasoning | null;
  search: GroundingSearch | null;
  tools: any | null;

  sessionId: string | null;
  topicId: string | null;
  threadId: string | null;
  agentId: string | null;

  parentId: string | null;
  quotaId: string | null;
  favorite: boolean | null;
  metadata?: MessageMetadata | null;
  error: any | null;
  model: string | null;
  provider: string | null;

  traceId: string | null;
  observationId: string | null;

  clientId: string | null;

  userId: string;
  updatedAt: Date;
  createdAt: Date;
}

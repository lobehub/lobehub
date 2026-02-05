/* eslint-disable sort-keys-fix/sort-keys-fix , typescript-sort-keys/interface */
import type { GroundingSearch } from '../../search';
import type { MessageMetadata, ModelReasoning, ToolIntervention } from '../common';

export interface DBMessageItem {
  agentId: string | null;

  clientId: string | null;
  content: string;
  createdAt: Date;
  error: any | null;
  favorite: boolean | null;

  id: string;
  metadata?: MessageMetadata | null;
  model: string | null;
  observationId: string | null;

  parentId: string | null;
  provider: string | null;
  quotaId: string | null;
  reasoning: ModelReasoning | null;
  role: string;
  search: GroundingSearch | null;
  sessionId: string | null;

  threadId: string | null;
  tools: any | null;

  topicId: string | null;

  traceId: string | null;
  updatedAt: Date;
  userId: string;
}

export interface MessagePluginItem {
  apiName?: string;
  arguments?: string;
  clientId?: string;
  error?: any;
  id: string;
  identifier?: string;
  intervention?: ToolIntervention;
  state?: any;
  toolCallId?: string;
  type: string;
  userId: string;
}

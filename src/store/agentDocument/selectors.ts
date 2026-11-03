import type { AgentDocumentListItem } from '@/services/agentDocument';

import type { AgentDocumentState } from './initialState';
import {
  type AgentDocumentReaderDetail,
  agentDocumentReaderKey,
  type AgentDocumentReaderParams,
} from './projection';

/** One agent's document list, or `undefined` before its first paint. */
const getDocumentList =
  (agentId?: string | null) =>
  (s: AgentDocumentState): AgentDocumentListItem[] | undefined =>
    agentId ? s.agentDocumentListMap[agentId] : undefined;

/**
 * The list on screen is one the server answered this session (not only the
 * copy persisted by an earlier one). Absence of a row is only conclusive then:
 * a persisted list predates any document created since.
 */
const isDocumentListConfirmed =
  (agentId?: string | null) =>
  (s: AgentDocumentState): boolean => {
    if (!agentId) return false;
    return s.agentDocumentListReplica.entries[agentId]?.source === 'server';
  };

/** One reader entry, or `undefined` before its first paint. */
const getReaderDocument =
  (params?: AgentDocumentReaderParams | null) =>
  (s: AgentDocumentState): AgentDocumentReaderDetail | undefined =>
    params ? s.agentDocumentReaderMap[agentDocumentReaderKey(params)] : undefined;

export const agentDocumentSelectors = {
  getDocumentList,
  getReaderDocument,
  isDocumentListConfirmed,
};

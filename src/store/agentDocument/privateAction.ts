import { createReplicaSlice, recordLens } from '@/libs/replica';
import { type AgentDocumentListItem, agentDocumentService } from '@/services/agentDocument';
import type { StoreSetter } from '@/store/types';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { type AgentDocumentState } from './initialState';
import {
  agentDocumentListResource,
  type AgentDocumentReaderDetail,
  agentDocumentReaderResource,
  toAgentDocumentReaderContent,
} from './projection';

type Setter = StoreSetter<AgentDocumentState>;

const READER_ACCESS_LOST = ['NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED'] as const;

export class AgentDocumentPrivateAction {
  readonly list;
  readonly reader;

  constructor(set: Setter, get: () => AgentDocumentState) {
    this.list = createReplicaSlice(agentDocumentListResource, {
      actionPrefix: 'agentDocumentList',
      fetcher: (agentId) => agentDocumentService.listDocuments({ agentId }),
      get,
      set,
      stateKey: 'agentDocumentListReplica',
      view: recordLens<AgentDocumentState, AgentDocumentListItem[]>('agentDocumentListMap'),
    });
    this.reader = createReplicaSlice(agentDocumentReaderResource, {
      actionPrefix: 'agentDocumentReader',
      fetcher: async ({ agentId, documentId }) => {
        try {
          const document = await agentDocumentService.getReaderDocument({ agentId, documentId });
          return { document: toAgentDocumentReaderContent(document) };
        } catch (error) {
          // A deleted (or never-owned) document, or one this session may no
          // longer read, is an answer, not a failure: it must evict the body a
          // reload would otherwise paint before the server says no.
          if (READER_ACCESS_LOST.some((code) => isTrpcErrorCode(error, code))) {
            return { document: null, missingMessage: (error as Error).message };
          }
          throw error;
        }
      },
      get,
      set,
      stateKey: 'agentDocumentReaderReplica',
      // "Not found" is a page state: never persist it, and evict the body
      // persisted earlier so a reload cannot resurrect a deleted document.
      toPersisted: (data) => (data.document ? data : null),
      view: recordLens<AgentDocumentState, AgentDocumentReaderDetail>('agentDocumentReaderMap'),
    });
  }
}

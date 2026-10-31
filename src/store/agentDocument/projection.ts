import { defineReplica } from '@/libs/replica';
import type { AgentDocumentListItem } from '@/services/agentDocument';

/** Agents whose document list survives a reload, most recently used first. */
const MAX_PERSISTED_AGENT_DOCUMENT_LISTS = 30;
/** Reader documents whose body survives a reload, most recently used first. */
const MAX_PERSISTED_READER_DOCUMENTS = 20;

/**
 * One agent's full document list (documents, web clips and skill bundles),
 * keyed by `agentId` (`agentDocumentListMap[agentId]`).
 *
 * The working sidebar, the agent document page header, entity links and the
 * agent-documents tool cards all read this one entry, so the persisted copy
 * paints every one of them on a cold start and the network only confirms.
 * Rows carry metadata only (no body); the cap bounds how many agents' lists a
 * long-lived scope keeps on disk.
 */
export const agentDocumentListResource = defineReplica<string, AgentDocumentListItem[]>({
  key: (agentId) => agentId,
  name: 'agentDocumentList',
  persist: { maxEntries: MAX_PERSISTED_AGENT_DOCUMENT_LISTS },
  storage: 'indexedDB',
  version: 1,
});

export interface AgentDocumentReaderParams {
  agentId: string;
  documentId: string;
}

/**
 * Entry identity of one reader document. Document ids are only unique per
 * agent binding as far as the reader is concerned (the server checks the agent
 * owns it), so the agent is part of the key.
 */
export const agentDocumentReaderKey = ({ agentId, documentId }: AgentDocumentReaderParams) =>
  `${agentId}/${documentId}`;

/** What the read-only reader paints — the server row minus its editor state. */
export interface AgentDocumentReaderContent {
  content: string;
  filename: string;
  title: string;
}

/**
 * The value of one reader entry. Wrapped so "the server answered not found"
 * (`document: null`) is a value the page can settle on, distinct from "nothing
 * loaded yet" (no entry). The not-found marker is never persisted.
 */
export interface AgentDocumentReaderDetail {
  document: AgentDocumentReaderContent | null;
  /** The server's not-found message, shown in place of the body. */
  missingMessage?: string;
}

/** Keep only the fields the reader renders: the row also carries `editorData`. */
export const toAgentDocumentReaderContent = (doc: {
  content?: string | null;
  filename?: string | null;
  title?: string | null;
}): AgentDocumentReaderContent => ({
  content: doc.content ?? '',
  filename: doc.filename ?? '',
  title: doc.title ?? '',
});

/**
 * The standalone read-only agent document view, one entry per agent + document
 * (`agentDocumentReaderMap[agentDocumentReaderKey(params)]`). Bodies can be
 * large, so the cap keeps only the most recently read documents on disk.
 */
export const agentDocumentReaderResource = defineReplica<
  AgentDocumentReaderParams,
  AgentDocumentReaderDetail
>({
  key: agentDocumentReaderKey,
  name: 'agentDocumentReader',
  persist: { maxEntries: MAX_PERSISTED_READER_DOCUMENTS },
  storage: 'indexedDB',
  version: 1,
});

import type { agentDocumentService } from '@/services/agentDocument';

export type AgentDocumentItem = Awaited<
  ReturnType<typeof agentDocumentService.listDocuments>
>[number];

/**
 * Edits the agent's document list: a value or updater applies a client-side
 * edit (re-synced afterwards unless `revalidate: false`); no argument re-syncs.
 */
export type AgentDocumentListMutator = (
  data?:
    | AgentDocumentItem[]
    | ((prev: AgentDocumentItem[] | undefined) => AgentDocumentItem[] | undefined),
  options?: { revalidate?: boolean },
) => Promise<unknown>;

export const PENDING_ID_PREFIX = 'pending:';

export const isPendingId = (id: string): boolean => id.startsWith(PENDING_ID_PREFIX);

type SkillBundleRef = Pick<AgentDocumentItem, 'documentId' | 'isSkillBundle'>;
type SkillChildRef = Pick<AgentDocumentItem, 'isSkillIndex' | 'parentId'>;

export const hasSkillIndexChild = (
  documents: SkillChildRef[],
  bundle: Pick<AgentDocumentItem, 'documentId'>,
): boolean => documents.some((doc) => doc.isSkillIndex && doc.parentId === bundle.documentId);

export const isOrphanSkillBundleItem = (doc: SkillBundleRef, documents: SkillChildRef[]): boolean =>
  doc.isSkillBundle && !hasSkillIndexChild(documents, doc);

export const isProtectedManagedSkillItem = (
  doc: Pick<AgentDocumentItem, 'category' | 'documentId' | 'isSkillBundle'>,
  documents: SkillChildRef[],
): boolean => doc.category === 'skill' && !isOrphanSkillBundleItem(doc, documents);

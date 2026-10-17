import { revalidateReplica } from '@/libs/replica';
import {
  agentDocumentListResource,
  agentDocumentReaderKey,
  agentDocumentReaderResource,
} from '@/store/agentDocument/projection';
import { documentDetailResource } from '@/store/document/slices/document/projection';
import { notebookDocumentsResource } from '@/store/notebook/projection';
import { pageDetailResource, pageListResource } from '@/store/page/projection';
import { agentDocumentSkillsResource } from '@/store/tool/slices/agentDocumentSkills/projection';

export type DocumentMutationCause =
  'agent-document' | 'document-service' | 'notebook' | 'page-title';

export interface InvalidateDocumentMutationParams {
  agentId?: string;
  cause?: DocumentMutationCause;
  documentId?: string;
  refreshDocumentEditor?: boolean;
  refreshPageDocuments?: boolean;
  topicId?: string;
}

export const invalidateDocumentMutation = async (
  params: InvalidateDocumentMutationParams,
): Promise<void> => {
  const { agentId, documentId, refreshDocumentEditor, refreshPageDocuments, topicId } = params;
  const revalidations: Promise<unknown>[] = [];

  if (documentId) {
    if (refreshDocumentEditor !== false) {
      // The document detail is a replica; its sync lives outside the SWR cache
      // keyed by `document:editor`, so revalidate the replica instead.
      revalidations.push(revalidateReplica(documentDetailResource, documentId));
    }
    // The page domain is a `@lobechat/replica` domain, so its by-id copy and
    // its list sync through `replica:sync` keys rather than the SWR cache:
    // refresh them here or a rename / move would not reach the Pages sidebar or
    // the page header until a remount.
    revalidations.push(revalidateReplica(pageDetailResource, documentId));
  }

  if (documentId || refreshPageDocuments) {
    revalidations.push(revalidateReplica(pageListResource));
  }

  if (topicId) {
    // The topic's document list is a replica, so its sync lives outside the
    // legacy `notebook:documents` SWR entry. Refresh the affected topic only: a
    // create / update / delete must reach the notebook portal without waiting
    // for a remount.
    revalidations.push(revalidateReplica(notebookDocumentsResource, topicId));
  }

  if (agentId) {
    // The agent's document list is a replica keyed by agent: one entry feeds the
    // working sidebar, the document page header, entity links and tool cards.
    revalidations.push(revalidateReplica(agentDocumentListResource, agentId));
    // The slash-menu skill registry is a replica of its own (a web-free list).
    // Refresh it here too: a create / delete / convert-to-skill must reach the
    // menu without waiting for a remount.
    revalidations.push(revalidateReplica(agentDocumentSkillsResource, agentId));
  }

  if (agentId && documentId) {
    revalidations.push(
      revalidateReplica(
        agentDocumentReaderResource,
        agentDocumentReaderKey({ agentId, documentId }),
      ),
    );
  }

  const results = await Promise.allSettled(revalidations);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[DocumentInvalidation] Failed to revalidate document cache:', result.reason);
    }
  }
};

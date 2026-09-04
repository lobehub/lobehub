'use client';

import AgentDocumentPage from '@/features/AgentDocumentPage';
import { useParams } from '@/libs/router/navigation';
import { getIdFromIdentifier } from '@/utils/identifier';

const AgentDocumentRoute = () => {
  const { docId } = useParams<{ docId: string }>('docId');
  const documentId = getIdFromIdentifier(docId ?? '', 'docs');

  // key remounts the editor when switching between documents
  return <AgentDocumentPage documentId={documentId} key={documentId} />;
};

export default AgentDocumentRoute;

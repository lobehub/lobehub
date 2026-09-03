'use client';

import { useParams } from 'react-router';

import AgentDocumentPage from '@/features/AgentDocumentPage';
import { getIdFromIdentifier } from '@/utils/identifier';

const AgentDocumentRoute = () => {
  const { docId } = useParams<{ docId: string }>();
  const documentId = getIdFromIdentifier(docId ?? '', 'docs');

  // key remounts the editor when switching between documents
  return <AgentDocumentPage documentId={documentId} key={documentId} />;
};

export default AgentDocumentRoute;

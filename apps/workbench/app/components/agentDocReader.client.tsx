import { useParams } from 'react-router';

import AgentDocumentReader from '@/features/AgentDocumentReader';
import { getIdFromIdentifier } from '@/utils/identifier';

export default function AgentDocReader() {
  const { aid = '', docId = '' } = useParams<{ aid: string; docId: string }>();
  const agentId = getIdFromIdentifier(aid, 'agt');
  const documentId = getIdFromIdentifier(docId, 'docs');

  return <AgentDocumentReader agentId={agentId} documentId={documentId} />;
}

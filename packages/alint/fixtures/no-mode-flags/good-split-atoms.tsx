// Fixture: read and edit are separate atoms; each host mounts what it needs.
import { Markdown } from '@lobehub/ui';
import { memo } from 'react';

import { useDocumentContent } from '@/store/document/hooks/useDocumentContent';

export const DocumentReader = memo<{ id: string }>(({ id }) => {
  const { data } = useDocumentContent(id);
  return <Markdown>{data?.content ?? ''}</Markdown>;
});

export default DocumentReader;

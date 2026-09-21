// Fixture: one fat viewer that switches off editing, hotkeys and upload with readOnly.
import { Markdown } from '@lobehub/ui';
import { memo } from 'react';

import { DocumentEditor } from '@/features/DocumentEditor';
import { useDocumentHotkeys } from '@/features/DocumentEditor/hooks/useDocumentHotkeys';
import { useUploadDropZone } from '@/features/Upload/useUploadDropZone';
import { useDocumentSWR } from '@/store/document/hooks';

interface Props {
  id: string;
  readOnly?: boolean;
}

// alint-expect
const DocumentViewer = memo<Props>(({ id, readOnly }) => {
  const { data } = useDocumentSWR(id);
  useDocumentHotkeys({ enabled: !readOnly });
  const dropZone = useUploadDropZone({ disabled: readOnly });

  if (readOnly) return <Markdown>{data?.content ?? ''}</Markdown>;

  return (
    <div {...dropZone.bind}>
      <DocumentEditor content={data?.content ?? ''} id={id} />
    </div>
  );
});

export default DocumentViewer;

'use client';

import { Center, Empty, Flexbox, Markdown } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';

interface PagePreviewProps {
  id: string;
}

/**
 * Read-only preview of a page (文稿) inside the detail panel. Pages carry no
 * file URL, so render the document's Markdown content instead of FileViewer.
 */
const PagePreview = memo<PagePreviewProps>(({ id }) => {
  const { data: document, isLoading } = useClientDataSWR(portalKeys.documentHeader(id), () =>
    documentService.getDocumentById(id),
  );

  if (isLoading)
    return (
      <Flexbox padding={24}>
        <Skeleton.Text rows={6} width={['60%', '90%', '80%', '85%', '70%', '40%']} />
      </Flexbox>
    );

  if (!document?.content)
    return (
      <Center height={'100%'} width={'100%'}>
        <Empty />
      </Center>
    );

  return (
    <Flexbox paddingBlock={16} paddingInline={24}>
      <Markdown variant={'chat'}>{document.content}</Markdown>
    </Flexbox>
  );
});

PagePreview.displayName = 'PagePreview';

export default PagePreview;

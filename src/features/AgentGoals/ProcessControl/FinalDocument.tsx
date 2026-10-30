'use client';

import { Flexbox, Markdown, Skeleton } from '@lobehub/ui';

import { useEntityMarkdown } from '@/features/EntityLink';
import { useDocumentStore } from '@/store/document';

/** The document the Goal's work wrote, read in full as the delivery itself. */
const FinalDocument = ({ documentId }: { documentId: string }) => {
  // The graph carries only the document id; its content is read for the page.
  const markdownProps = useEntityMarkdown();
  const useFetchDocumentDetail = useDocumentStore((s) => s.useFetchDocumentDetail);
  const { data: document, isHydrated, isLoading } = useFetchDocumentDetail(documentId);

  if (isLoading && !isHydrated) return null;
  if (isLoading)
    return (
      <Flexbox gap={10}>
        <Skeleton height={24} radius={4} width={'40%'} />
        <Skeleton height={14} radius={4} />
        <Skeleton height={14} radius={4} />
        <Skeleton height={14} radius={4} width={'70%'} />
      </Flexbox>
    );

  return (
    <Markdown variant={'chat'} {...markdownProps}>
      {document?.content ?? ''}
    </Markdown>
  );
};

export default FinalDocument;

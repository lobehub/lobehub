'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { lazy, memo, Suspense } from 'react';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { useBlobFileLoader } from '../../hooks/useBlobFileLoader';
import NotSupport from '../../NotSupport';
import OfficeOnlinePane from '../Document/OfficeOnlinePane';

// Deferred: pulls in react-pdf and the office renderers.
const DocumentPreview = lazy(() => import('../Document'));

const OFFICE_MIME_TYPES: Record<string, string> = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const OFFICE_MIME_VALUES = new Set(Object.values(OFFICE_MIME_TYPES));

// `fileType` is either a bare extension or a full MIME depending on how the file
// was uploaded; the renderer map keys on MIME, so normalize both to a MIME.
export const resolveContentType = (fileType?: string, fileName?: string): string => {
  const lowerFileType = fileType?.toLowerCase();
  if (lowerFileType) {
    if (OFFICE_MIME_VALUES.has(lowerFileType)) return lowerFileType;
    if (OFFICE_MIME_TYPES[lowerFileType]) return OFFICE_MIME_TYPES[lowerFileType];
  }

  const extension = fileName?.toLowerCase().split('.').at(-1);
  return (extension && OFFICE_MIME_TYPES[extension]) || 'application/octet-stream';
};

interface MSDocViewerProps {
  fileId: string;
  fileName?: string;
  fileType?: string;
  url: string | null;
}

const MSDocViewer = memo<MSDocViewerProps>(({ fileName, fileType, url }) => {
  const { blob, error, loading, tooLarge } = useBlobFileLoader(url);

  if (loading)
    return (
      <Center height={'100%'} width={'100%'}>
        <NeuralNetworkLoading size={36} />
      </Center>
    );

  // Oversized or unreachable for an in-app render, but the online viewer only
  // needs the URL — it downloads the file server-side.
  if (!blob) {
    if (url) return <OfficeOnlinePane url={url} />;

    return (
      <Flexbox height={'100%'} width={'100%'}>
        {error && <AsyncError error={error} variant={'block'} />}
        <NotSupport fileName={fileName} tooLarge={tooLarge} url={url} />
      </Flexbox>
    );
  }

  return (
    <Suspense
      fallback={
        <Center height={'100%'} width={'100%'}>
          <NeuralNetworkLoading size={36} />
        </Center>
      }
    >
      <DocumentPreview
        blob={blob}
        contentType={resolveContentType(fileType, fileName)}
        filePath={fileName ?? ''}
        isLocalFile={false}
        sourceUrl={url}
      />
    </Suspense>
  );
});

MSDocViewer.displayName = 'MSDocViewer';

export default MSDocViewer;

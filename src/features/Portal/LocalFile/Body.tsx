import { buildLocalFileUrl, isDesktop } from '@lobechat/const';
import { Center, Empty, Flexbox, Highlighter } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/CircleLoading';
import { useClientDataSWR } from '@/libs/swr';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { extensionToLanguage, getFileExtension } from './Body.helpers';

const MAX_PREVIEW_CHARS = 500_000;

const TEXT_PREVIEW_MIME_TYPES = new Set([
  'application/graphql',
  'application/javascript',
  'application/json',
  'application/markdown',
  'application/toml',
  'application/xml',
  'application/yaml',
  'text/markdown',
  'text/x-markdown',
]);

interface BinaryLocalFilePreview {
  contentType: string;
  type: 'binary';
}

interface ImageLocalFilePreview {
  blob: Blob;
  contentType: string;
  type: 'image';
}

interface TextLocalFilePreview {
  content: string;
  contentType: string;
  type: 'text';
}

type LocalFilePreview = BinaryLocalFilePreview | ImageLocalFilePreview | TextLocalFilePreview;

const normalizeContentType = (contentType: string | null): string =>
  contentType?.split(';')[0].trim().toLowerCase() ?? '';

const isTextPreviewMimeType = (mimeType: string): boolean =>
  mimeType.startsWith('text/') || TEXT_PREVIEW_MIME_TYPES.has(mimeType);

const fetchLocalFilePreview = async (url: string): Promise<LocalFilePreview> => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load local file: ${response.status}`);
  }

  const contentType = normalizeContentType(response.headers.get('content-type'));

  if (contentType.startsWith('image/')) {
    return { blob: await response.blob(), contentType, type: 'image' };
  }

  if (isTextPreviewMimeType(contentType)) {
    return { content: await response.text(), contentType, type: 'text' };
  }

  return { contentType, type: 'binary' };
};

interface ImagePreviewProps {
  blob: Blob;
  filename: string;
}

const ImagePreview = memo<ImagePreviewProps>(({ blob, filename }) => {
  const [imageSrc, setImageSrc] = useState<string>();

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setImageSrc(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);

  if (!imageSrc) return <Loading />;

  return (
    <Center height={'100%'} style={{ overflow: 'auto' }} width={'100%'}>
      <img alt={filename} src={imageSrc} style={{ maxWidth: '100%', objectFit: 'contain' }} />
    </Center>
  );
});

ImagePreview.displayName = 'ImagePreview';

// ============== ActiveFileView ==============

interface ActiveFileViewProps {
  filePath: string;
  workingDirectory: string;
}

const ActiveFileView = memo<ActiveFileViewProps>(({ filePath }) => {
  const { t } = useTranslation('chat');

  const filename = filePath.split('/').at(-1) ?? '';
  const localFileUrl = isDesktop ? buildLocalFileUrl(filePath) : null;
  const {
    data: preview,
    error,
    isLoading,
  } = useClientDataSWR(
    localFileUrl ? ['local-file-preview', localFileUrl] : null,
    async () => {
      if (!localFileUrl) throw new Error('Missing local file URL');
      return fetchLocalFilePreview(localFileUrl);
    },
    { revalidateOnFocus: false },
  );

  // Chromium blocks `file://` from a non-file origin. The desktop main process
  // exposes local disk files through `localfile://`; the renderer fetches that
  // URL for every file type and keeps rendering inside our own components.
  if (!localFileUrl) {
    return (
      <Center height={'100%'} width={'100%'}>
        <Empty description={t('workingPanel.localFile.binary')} />
      </Center>
    );
  }

  if (isLoading) return <Loading />;

  if (error || !preview) {
    return (
      <Center height={'100%'} width={'100%'}>
        <Empty description={t('workingPanel.localFile.error')} />
      </Center>
    );
  }

  if (preview.type === 'binary') {
    return (
      <Center height={'100%'} width={'100%'}>
        <Empty description={t('workingPanel.localFile.binary')} />
      </Center>
    );
  }

  if (preview.type === 'image') {
    return <ImagePreview blob={preview.blob} filename={filename} />;
  }

  const ext = getFileExtension(filename);
  const truncated = preview.content.length > MAX_PREVIEW_CHARS;
  const displayContent = truncated ? preview.content.slice(0, MAX_PREVIEW_CHARS) : preview.content;

  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'auto' }}>
      {truncated && (
        <Center paddingBlock={4} style={{ flexShrink: 0 }}>
          <span style={{ fontSize: 12, opacity: 0.65 }}>
            {t('workingPanel.localFile.truncated', { limit: MAX_PREVIEW_CHARS.toLocaleString() })}
          </span>
        </Center>
      )}
      <Flexbox flex={1} style={{ minHeight: 0, overflow: 'auto' }}>
        <Highlighter
          language={extensionToLanguage(ext)}
          style={{ fontSize: 12, minHeight: '100%', overflow: 'visible' }}
        >
          {displayContent}
        </Highlighter>
      </Flexbox>
    </Flexbox>
  );
});

ActiveFileView.displayName = 'ActiveFileView';

// ============== Body ==============

const Body = memo(() => {
  const openLocalFiles = useChatStore(chatPortalSelectors.openLocalFiles);
  const activeFile = useChatStore(chatPortalSelectors.currentLocalFile);

  if (openLocalFiles.length === 0) return null;
  if (!activeFile) return null;

  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
      <ActiveFileView
        filePath={activeFile.filePath}
        workingDirectory={activeFile.workingDirectory}
      />
    </Flexbox>
  );
});

Body.displayName = 'LocalFileBody';

export default Body;

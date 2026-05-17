import { isDesktop } from '@lobechat/const';
import { Center, Empty, Flexbox, Highlighter, Icon, Markdown, Segmented, Text } from '@lobehub/ui';
import { CodeIcon, EyeIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/CircleLoading';
import { useClientDataSWR } from '@/libs/swr';
import { localFileService } from '@/services/electron/localFileService';
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

// ============== TextPreviewPane ==============

const MARKDOWN_EXTS = new Set(['md', 'mdx', 'markdown']);
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

interface ParsedFrontmatter {
  body: string;
  data: { description?: string; name?: string };
  raw: string;
}

const parseFrontmatter = (content: string): ParsedFrontmatter | null => {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;

  const data: ParsedFrontmatter['data'] = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (key !== 'name' && key !== 'description') continue;
    let value = line.slice(colonIdx + 1).trim();
    if (value.startsWith('|') || value.startsWith('>')) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }

  return { body: content.slice(match[0].length), data, raw: match[0] };
};

type TextPreviewMode = 'render' | 'raw';

interface TextPreviewPaneProps {
  content: string;
  ext: string;
  truncated: boolean;
  truncatedLabel: string;
}

const TextPreviewPane = memo<TextPreviewPaneProps>(
  ({ content, ext, truncated, truncatedLabel }) => {
    const { t } = useTranslation('chat');
    const isMarkdown = useMemo(() => MARKDOWN_EXTS.has(ext.toLowerCase()), [ext]);
    const frontmatter = useMemo(
      () => (isMarkdown ? parseFrontmatter(content) : null),
      [isMarkdown, content],
    );
    const [mode, setMode] = useState<TextPreviewMode>(isMarkdown ? 'render' : 'raw');

    useEffect(() => {
      setMode(isMarkdown ? 'render' : 'raw');
    }, [isMarkdown]);

    return (
      <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
        {isMarkdown && (
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            paddingBlock={6}
            paddingInline={12}
            style={{ flexShrink: 0 }}
          >
            <Text ellipsis style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0 }}>
              {frontmatter?.data.name ?? ''}
            </Text>
            <Segmented
              size={'small'}
              value={mode}
              options={[
                {
                  icon: <Icon icon={EyeIcon} />,
                  label: t('workingPanel.localFile.preview.render'),
                  value: 'render',
                },
                {
                  icon: <Icon icon={CodeIcon} />,
                  label: t('workingPanel.localFile.preview.raw'),
                  value: 'raw',
                },
              ]}
              onChange={(v) => setMode(v as TextPreviewMode)}
            />
          </Flexbox>
        )}
        {truncated && (
          <Center paddingBlock={4} style={{ flexShrink: 0 }}>
            <span style={{ fontSize: 12, opacity: 0.65 }}>{truncatedLabel}</span>
          </Center>
        )}
        <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
          {isMarkdown && mode === 'render' ? (
            <Markdown
              style={{ height: '100%', overflow: 'auto', paddingBlock: 8, paddingInline: 12 }}
            >
              {frontmatter ? frontmatter.body : content}
            </Markdown>
          ) : (
            <Flexbox flex={1} style={{ minHeight: 0, overflow: 'auto' }}>
              <Highlighter
                language={extensionToLanguage(ext)}
                style={{ fontSize: 12, minHeight: '100%', overflow: 'visible' }}
              >
                {content}
              </Highlighter>
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

TextPreviewPane.displayName = 'TextPreviewPane';

// ============== ActiveFileView ==============

interface ActiveFileViewProps {
  filePath: string;
  workingDirectory: string;
}

const ActiveFileView = memo<ActiveFileViewProps>(({ filePath, workingDirectory }) => {
  const { t } = useTranslation('chat');

  const filename = filePath.split('/').at(-1) ?? '';
  const {
    data: preview,
    error,
    isLoading,
  } = useClientDataSWR(
    isDesktop && workingDirectory ? ['local-file-preview', filePath, workingDirectory] : null,
    async () => {
      const result = await localFileService.getLocalFilePreviewUrl({
        path: filePath,
        workingDirectory,
      });

      if (!result.success || !result.url) {
        throw new Error(result.error || 'Missing local file preview URL');
      }

      return fetchLocalFilePreview(result.url);
    },
    { revalidateOnFocus: false },
  );

  // Chromium blocks `file://` from a non-file origin. The desktop main process
  // mints short-lived `localfile://` preview URLs for approved workspace files.
  if (!isDesktop) {
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
    <TextPreviewPane
      content={displayContent}
      ext={ext}
      truncated={truncated}
      truncatedLabel={t('workingPanel.localFile.truncated', {
        limit: MAX_PREVIEW_CHARS.toLocaleString(),
      })}
    />
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

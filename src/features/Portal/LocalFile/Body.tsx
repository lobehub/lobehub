import { isDesktop, MARKDOWN_MIME_TYPES } from '@lobechat/const';
import { Center, Empty, Flexbox, Icon, Markdown, Segmented, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CodeIcon, EyeIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CodeEditorPane from '@/components/CodeEditorPane';
import Loading from '@/components/Loading/CircleLoading';
import { useClientDataSWR } from '@/libs/swr';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import {
  parseSkillMarkdownFrontmatter,
  parseSkillMarkdownFrontmatterFields,
  parseSkillMarkdownMetadata,
  type SkillMarkdownMetadataItem,
} from '@/utils/skillMarkdown';

import { extensionToLanguage, getFileExtension } from './Body.helpers';

const TEXT_PREVIEW_MIME_TYPES = new Set([
  'application/graphql',
  'application/javascript',
  'application/json',
  'application/markdown',
  'application/toml',
  'application/xml',
  'application/yaml',
  ...MARKDOWN_MIME_TYPES,
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

const frontmatterStyles = createStaticStyles(({ css }) => ({
  card: css`
    margin-block: 8px 12px;
    margin-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};
  `,
  key: css`
    flex-shrink: 0;

    width: 96px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  row: css`
    padding-block: 8px;
    padding-inline: 12px;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  value: css`
    min-width: 0;
    font-size: 12px;
    white-space: pre-wrap;
  `,
}));

interface SkillFrontmatterPreviewCardProps {
  metadata: SkillMarkdownMetadataItem[];
}

const SkillFrontmatterPreviewCard = memo<SkillFrontmatterPreviewCardProps>(({ metadata }) => {
  if (metadata.length === 0) return null;

  return (
    <Flexbox className={frontmatterStyles.card} style={{ flexShrink: 0 }}>
      {metadata.map((item) => (
        <Flexbox horizontal align={'flex-start'} className={frontmatterStyles.row} key={item.key}>
          <Text className={frontmatterStyles.key}>{item.key}</Text>
          <Text className={frontmatterStyles.value}>{item.value}</Text>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

SkillFrontmatterPreviewCard.displayName = 'SkillFrontmatterPreviewCard';

type TextPreviewMode = 'render' | 'raw';

interface TextPreviewPaneProps {
  content: string;
  ext: string;
  filePath: string;
  onSaved?: (savedContent: string) => void;
}

const TextPreviewPane = memo<TextPreviewPaneProps>(({ content, ext, filePath, onSaved }) => {
  const { t } = useTranslation('chat');
  const isMarkdown = useMemo(() => MARKDOWN_EXTS.has(ext.toLowerCase()), [ext]);
  const buffer = useChatStore(chatPortalSelectors.localFileBuffer(filePath));
  const setLocalFileBuffer = useChatStore((s) => s.setLocalFileBuffer);
  const saveLocalFile = useChatStore((s) => s.saveLocalFile);

  const editingValue = buffer ?? content;

  const handleCodeChange = useCallback(
    (next: string) => {
      if (next === content) {
        setLocalFileBuffer(filePath, undefined);
      } else {
        setLocalFileBuffer(filePath, next);
      }
    },
    [content, filePath, setLocalFileBuffer],
  );

  const handleSave = useCallback(async () => {
    try {
      const saved = await saveLocalFile(filePath);
      if (saved === undefined) return;
      // Update SWR cache BEFORE clearing the buffer, otherwise React will
      // briefly render with buffer cleared but content still stale, causing
      // CodeMirror to setValue and reset the cursor.
      onSaved?.(saved);
      setLocalFileBuffer(filePath, undefined);
    } catch {
      /* swallow — surfacing handled elsewhere if needed */
    }
  }, [filePath, onSaved, saveLocalFile, setLocalFileBuffer]);

  const { body, frontmatter } = useMemo(
    () => (isMarkdown ? parseSkillMarkdownFrontmatter(editingValue) : { body: editingValue }),
    [isMarkdown, editingValue],
  );
  const frontmatterFields = useMemo(
    () => (frontmatter ? parseSkillMarkdownFrontmatterFields(frontmatter) : {}),
    [frontmatter],
  );
  const frontmatterMetadata = useMemo(
    () => (frontmatter ? parseSkillMarkdownMetadata(frontmatter) : []),
    [frontmatter],
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
            {frontmatterFields.name ?? ''}
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
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {isMarkdown && mode === 'render' ? (
          <>
            <SkillFrontmatterPreviewCard metadata={frontmatterMetadata} />
            <Markdown style={{ paddingBlock: 8, paddingInline: 12 }}>{body}</Markdown>
          </>
        ) : (
          <CodeEditorPane
            language={extensionToLanguage(ext)}
            style={{ fontSize: 12, minHeight: '100%' }}
            value={editingValue}
            onChange={handleCodeChange}
            onSave={handleSave}
          />
        )}
      </div>
    </Flexbox>
  );
});

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
    mutate,
  } = useClientDataSWR<LocalFilePreview>(
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

  const handleSavedContent = useCallback(
    (saved: string) => {
      mutate((prev) => (prev && prev.type === 'text' ? { ...prev, content: saved } : prev), {
        revalidate: false,
      });
    },
    [mutate],
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

  return (
    <TextPreviewPane
      content={preview.content}
      ext={ext}
      filePath={filePath}
      onSaved={handleSavedContent}
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

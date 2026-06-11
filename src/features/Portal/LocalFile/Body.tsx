import { isDesktop } from '@lobechat/const';
import { ActionIcon, Center, Empty, Flexbox, Icon, Markdown, Segmented, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CodeIcon, EyeIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CodeEditorPane from '@/components/CodeEditorPane';
import { InlineHtmlPreview, isHtmlFile } from '@/components/HtmlPreview';
import Loading from '@/components/Loading/CircleLoading';
import { useClientDataSWR } from '@/libs/swr';
import { type LocalFilePreview, projectFileService } from '@/services/projectFile';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import {
  parseSkillMarkdownFrontmatter,
  parseSkillMarkdownFrontmatterFields,
  parseSkillMarkdownMetadata,
  type SkillMarkdownMetadataItem,
} from '@/utils/skillMarkdown';

import { extensionToLanguage, getFileExtension } from './Body.helpers';

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

const NO_TOPIC_KEY = '__no_topic__';

interface TextPreviewPaneProps {
  activeTopicId?: string | null;
  content: string;
  contentType?: string;
  ext: string;
  filePath: string;
  onReload?: () => Promise<unknown> | void;
  onSaved?: (savedContent: string) => void;
  readOnly?: boolean;
  reloading?: boolean;
}

const TextPreviewPane = memo<TextPreviewPaneProps>(
  ({
    activeTopicId,
    content,
    contentType,
    ext,
    filePath,
    onReload,
    onSaved,
    readOnly = false,
    reloading = false,
  }) => {
    const { t } = useTranslation('chat');
    const isMarkdown = useMemo(() => MARKDOWN_EXTS.has(ext.toLowerCase()), [ext]);
    const isHtml = useMemo(
      () => isHtmlFile({ fileType: contentType, path: filePath }),
      [contentType, filePath],
    );
    const canRender = isMarkdown || isHtml;
    const buffer = useChatStore(chatPortalSelectors.localFileBuffer(filePath));
    const setLocalFileBuffer = useChatStore((s) => s.setLocalFileBuffer);
    const saveLocalFile = useChatStore((s) => s.saveLocalFile);

    const editingValue = readOnly ? content : (buffer ?? content);

    const handleCodeChange = useCallback(
      (next: string) => {
        if (readOnly) return;

        if (next === content) {
          setLocalFileBuffer(filePath, undefined);
        } else {
          setLocalFileBuffer(filePath, next);
        }
      },
      [content, filePath, readOnly, setLocalFileBuffer],
    );

    const handleSave = useCallback(async () => {
      if (readOnly) return;

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
    }, [filePath, onSaved, readOnly, saveLocalFile, setLocalFileBuffer]);

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
    const previewTitle = isMarkdown
      ? (frontmatterFields.name ?? '')
      : (filePath.split('/').at(-1) ?? filePath);

    const [modeByScope, setModeByScope] = useState<Record<string, TextPreviewMode>>({});
    const modeScopeKey = `${activeTopicId ?? NO_TOPIC_KEY}:${filePath}`;
    const mode = canRender ? (modeByScope[modeScopeKey] ?? 'render') : 'raw';
    const setMode = useCallback(
      (next: TextPreviewMode) => {
        setModeByScope((prev) => ({ ...prev, [modeScopeKey]: next }));
      },
      [modeScopeKey],
    );
    const showHtmlPreview = isHtml && mode === 'render';
    const [htmlPreviewRevision, setHtmlPreviewRevision] = useState(0);
    const handleReloadPreview = useCallback(async () => {
      await onReload?.();
      setHtmlPreviewRevision((prev) => prev + 1);
    }, [onReload]);

    return (
      <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
        {canRender && (
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            paddingBlock={6}
            paddingInline={12}
            style={{ flexShrink: 0 }}
          >
            <Text ellipsis style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0 }}>
              {previewTitle}
            </Text>
            {isHtml && (
              <ActionIcon
                icon={RefreshCwIcon}
                loading={reloading}
                size={'small'}
                title={t('workingPanel.localFile.preview.reload')}
                onClick={handleReloadPreview}
              />
            )}
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
                  label: t(
                    isHtml
                      ? 'workingPanel.localFile.preview.source'
                      : 'workingPanel.localFile.preview.raw',
                  ),
                  value: 'raw',
                },
              ]}
              onChange={(v) => setMode(v as TextPreviewMode)}
            />
          </Flexbox>
        )}
        <div style={{ flex: 1, minHeight: 0, overflow: showHtmlPreview ? 'hidden' : 'auto' }}>
          {isMarkdown && mode === 'render' ? (
            <>
              <SkillFrontmatterPreviewCard metadata={frontmatterMetadata} />
              <Markdown style={{ paddingBlock: 8, paddingInline: 12 }}>{body}</Markdown>
            </>
          ) : showHtmlPreview ? (
            <InlineHtmlPreview content={editingValue} key={`${filePath}:${htmlPreviewRevision}`} />
          ) : (
            <CodeEditorPane
              language={extensionToLanguage(ext)}
              readOnly={readOnly}
              style={{ fontSize: 12, minHeight: '100%' }}
              value={editingValue}
              onChange={readOnly ? undefined : handleCodeChange}
              onSave={readOnly ? undefined : handleSave}
            />
          )}
        </div>
      </Flexbox>
    );
  },
);

TextPreviewPane.displayName = 'TextPreviewPane';

// ============== ActiveFileView ==============

interface ActiveFileViewProps {
  activeTopicId?: string | null;
  deviceId?: string;
  filePath: string;
  workingDirectory: string;
}

const ActiveFileView = memo<ActiveFileViewProps>(
  ({ activeTopicId, deviceId, filePath, workingDirectory }) => {
    const { t } = useTranslation('chat');

    const filename = filePath.split('/').at(-1) ?? '';
    const enabled = Boolean(workingDirectory) && (!!deviceId || isDesktop);
    const {
      data: preview,
      error,
      isLoading,
      isValidating,
      mutate,
    } = useClientDataSWR<LocalFilePreview>(
      enabled ? ['local-file-preview', deviceId ?? 'local', filePath, workingDirectory] : null,
      () =>
        projectFileService.getLocalFilePreview({
          deviceId,
          path: filePath,
          workingDirectory,
        }),
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

    const handleReload = useCallback(() => mutate(), [mutate]);

    if (isLoading) return <Loading />;

    if (error || !preview) {
      return (
        <Center height={'100%'} width={'100%'}>
          <Empty description={t('workingPanel.localFile.error')} />
        </Center>
      );
    }

    if (preview.type === 'image') {
      return <ImagePreview blob={preview.blob} filename={filename} />;
    }

    if (preview.type !== 'text') {
      return (
        <Center height={'100%'} width={'100%'}>
          <Empty description={t('workingPanel.localFile.binary')} />
        </Center>
      );
    }

    const ext = getFileExtension(filename);

    return (
      <TextPreviewPane
        activeTopicId={activeTopicId}
        content={preview.content}
        contentType={preview.contentType}
        ext={ext}
        filePath={filePath}
        readOnly={!!deviceId}
        reloading={isValidating}
        onReload={handleReload}
        onSaved={handleSavedContent}
      />
    );
  },
);

ActiveFileView.displayName = 'ActiveFileView';

// ============== Body ==============

const Body = memo(() => {
  const openLocalFiles = useChatStore(chatPortalSelectors.openLocalFiles);
  const activeFile = useChatStore(chatPortalSelectors.currentLocalFile);
  const activeTopicId = useChatStore((s) => s.activeTopicId);

  if (openLocalFiles.length === 0) return null;
  if (!activeFile) return null;

  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
      <ActiveFileView
        activeTopicId={activeTopicId}
        deviceId={activeFile.deviceId}
        filePath={activeFile.filePath}
        workingDirectory={activeFile.workingDirectory}
      />
    </Flexbox>
  );
});

Body.displayName = 'LocalFileBody';

export default Body;

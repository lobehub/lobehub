import { isDesktop } from '@lobechat/const';
import type { MarkdownProps } from '@lobehub/ui';
import { Center, Empty, Flexbox, Image, Markdown, Text, ToggleGroup } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CodeIcon, ExternalLinkIcon, EyeIcon, RefreshCwIcon } from 'lucide-react';
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CodeEditorPane from '@/components/CodeEditorPane';
import { applyHtmlPreviewBaseUrl, InlineHtmlPreview, isHtmlFile } from '@/components/HtmlPreview';
import Loading from '@/components/Loading/CircleLoading';
import {
  PublishHtmlArtifactLiveBar,
  PublishHtmlArtifactProvider,
  PublishHtmlArtifactTrigger,
} from '@/features/Portal/LocalFile/PublishHtmlArtifactButton';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { createLocalFileTabId } from '@/store/chat/slices/portal/helpers';
import { useLocalFilePreview, useLocalFilePreviewStore } from '@/store/localFilePreview';
import {
  parseSkillMarkdownFrontmatter,
  parseSkillMarkdownMetadata,
  type SkillMarkdownMetadataItem,
} from '@/utils/skillMarkdown';

import { getFileExtension } from './Body.helpers';
import MarkdownImage from './MarkdownImage';
import PreviewToolbar, { ToolbarActionButton, toolbarToggleClassNames } from './PreviewToolbar';
import UnsupportedPreview from './UnsupportedPreview';
import VideoPreview from './VideoPreview';

// Deferred: pulls in react-pdf, only needed once a binary document is opened.
const DocumentPreview = lazy(() => import('@/features/FileViewer/Renderer/Document'));

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
      <Image
        alt={filename}
        objectFit={'contain'}
        src={imageSrc}
        style={{ maxWidth: '100%' }}
        variant={'borderless'}
      />
    </Center>
  );
});

ImagePreview.displayName = 'ImagePreview';

// ============== TextPreviewPane ==============

const MARKDOWN_EXTS = new Set(['md', 'mdx', 'markdown']);

const frontmatterStyles = stylex.create({
  card: {
    marginBlockStart: '8px',
    marginBlockEnd: '12px',
    marginInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '8px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  key: {
    flexShrink: 0,
    width: '96px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  row: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderBlockEndWidth: { 'default': '1px', ':last-child': 0 },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  value: { minWidth: 0, fontSize: '12px', whiteSpace: 'pre-wrap' },
});

interface SkillFrontmatterPreviewCardProps {
  metadata: SkillMarkdownMetadataItem[];
}

const SkillFrontmatterPreviewCard = memo<SkillFrontmatterPreviewCardProps>(({ metadata }) => {
  if (metadata.length === 0) return null;

  return (
    <Flexbox className={stylex.props(frontmatterStyles.card).className} style={{ flexShrink: 0 }}>
      {metadata.map((item) => (
        <Flexbox
          horizontal
          align={'flex-start'}
          className={stylex.props(frontmatterStyles.row).className}
          key={item.key}
        >
          <Text className={stylex.props(frontmatterStyles.key).className}>{item.key}</Text>
          <Text className={stylex.props(frontmatterStyles.value).className}>{item.value}</Text>
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
  deviceId?: string;
  ext: string;
  filePath: string;
  onReload?: () => Promise<unknown> | void;
  /** Called when a save starts; returns the commit for the saved body. */
  onSaveStart?: () => (savedContent: string) => void;
  readOnly?: boolean;
  reloading?: boolean;
  resourceBaseUrl?: string;
  sandboxTopicId?: string;
  workingDirectory: string;
}

const TextPreviewPane = memo<TextPreviewPaneProps>(
  ({
    activeTopicId,
    content,
    contentType,
    deviceId,
    ext,
    filePath,
    onReload,
    onSaveStart,
    readOnly = false,
    reloading = false,
    resourceBaseUrl,
    sandboxTopicId,
    workingDirectory,
  }) => {
    const { t } = useTranslation('chat');
    const isMarkdown = useMemo(() => MARKDOWN_EXTS.has(ext.toLowerCase()), [ext]);
    const isHtml = useMemo(
      () => isHtmlFile({ fileType: contentType, path: filePath }),
      [contentType, filePath],
    );
    const canRender = isMarkdown || isHtml;
    // Edit buffers are scoped by tab identity (device + working directory + path)
    // so the same path opened on two devices/workspaces keeps independent edits.
    const tabId = useMemo(
      () => createLocalFileTabId({ deviceId, filePath, workingDirectory }),
      [deviceId, filePath, workingDirectory],
    );
    const buffer = useChatStore(chatPortalSelectors.localFileBuffer(tabId));
    const setLocalFileBuffer = useChatStore((s) => s.setLocalFileBuffer);
    const saveLocalFile = useChatStore((s) => s.saveLocalFile);

    const editingValue = readOnly ? content : (buffer ?? content);

    const handleCodeChange = useCallback(
      (next: string) => {
        if (readOnly) return;

        if (next === content) {
          setLocalFileBuffer(tabId, undefined);
        } else {
          setLocalFileBuffer(tabId, next);
        }
      },
      [content, tabId, readOnly, setLocalFileBuffer],
    );

    const handleSave = useCallback(async () => {
      if (readOnly) return;

      try {
        const commitSaved = onSaveStart?.();
        const saved = await saveLocalFile({ deviceId, filePath, workingDirectory });
        if (saved === undefined) return;
        // Update SWR cache BEFORE clearing the buffer, otherwise React will
        // briefly render with buffer cleared but content still stale, causing
        // CodeMirror to setValue and reset the cursor.
        commitSaved?.(saved);
        setLocalFileBuffer(tabId, undefined);
      } catch {
        /* swallow — surfacing handled elsewhere if needed */
      }
    }, [
      deviceId,
      filePath,
      onSaveStart,
      readOnly,
      saveLocalFile,
      setLocalFileBuffer,
      tabId,
      workingDirectory,
    ]);

    const { body, frontmatter } = useMemo(
      () => (isMarkdown ? parseSkillMarkdownFrontmatter(editingValue) : { body: editingValue }),
      [isMarkdown, editingValue],
    );
    const frontmatterMetadata = useMemo(
      () => (frontmatter ? parseSkillMarkdownMetadata(frontmatter) : []),
      [frontmatter],
    );
    const markdownComponents = useMemo(
      () =>
        ({
          img: (props) => (
            <MarkdownImage
              {...props}
              deviceId={deviceId}
              markdownFilePath={filePath}
              workingDirectory={workingDirectory}
            />
          ),
        }) satisfies MarkdownProps['components'],
      [deviceId, filePath, workingDirectory],
    );

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
    const showSourceView = showHtmlPreview || !(isMarkdown && mode === 'render');
    const [htmlPreviewRevision, setHtmlPreviewRevision] = useState(0);
    const handleReloadPreview = useCallback(async () => {
      await onReload?.();
      setHtmlPreviewRevision((prev) => prev + 1);
    }, [onReload]);
    // Electron's window-open handler denies blob: URLs, so the blob path only
    // works on web; desktop hands local files to the system default app instead,
    // and remote/sandbox files have no external route there.
    const canOpenExternal = isDesktop ? !deviceId && !sandboxTopicId : true;
    const handleOpenExternal = useCallback(() => {
      if (isDesktop) {
        void localFileService.openLocalFile({ path: filePath });
        return;
      }

      // A top-level blob: document inherits this app's origin, so untrusted HTML
      // must stay inside a sandboxed (no allow-same-origin) iframe wrapper.
      const html = applyHtmlPreviewBaseUrl(editingValue, resourceBaseUrl);
      const srcdoc = html.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
      const shell = `<!doctype html><title>${filePath.split(/[/\\]/).at(-1) ?? ''}</title><style>html,body{margin:0;height:100%}iframe{display:block;width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts allow-modals allow-popups" srcdoc="${srcdoc}"></iframe>`;
      const url = URL.createObjectURL(new Blob([shell], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      // Revoking immediately can abort the new window's document load — defer it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, [editingValue, filePath, resourceBaseUrl]);

    return (
      <PublishHtmlArtifactProvider
        content={editingValue}
        deviceId={deviceId}
        filePath={filePath}
        sandboxTopicId={sandboxTopicId}
        topicId={activeTopicId}
        workingDirectory={workingDirectory}
      >
        <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
          <PublishHtmlArtifactLiveBar />
          <PreviewToolbar
            deviceId={deviceId}
            path={filePath}
            rootPath={workingDirectory}
            actions={
              <>
                {isHtml && (
                  <ToolbarActionButton
                    icon={RefreshCwIcon}
                    loading={reloading}
                    title={t('workingPanel.localFile.preview.reload')}
                    onClick={handleReloadPreview}
                  />
                )}
                {canRender && (
                  <ToggleGroup
                    classNames={toolbarToggleClassNames}
                    value={mode}
                    variant={'outlined'}
                    options={[
                      {
                        icon: <EyeIcon size={14} />,
                        label: t('workingPanel.localFile.preview.render'),
                        value: 'render',
                      },
                      {
                        icon: <CodeIcon size={14} />,
                        label: t(
                          isHtml
                            ? 'workingPanel.localFile.preview.source'
                            : 'workingPanel.localFile.preview.raw',
                        ),
                        value: 'raw',
                      },
                    ]}
                    onChange={(value) => setMode(value as TextPreviewMode)}
                  />
                )}
                {isHtml && canOpenExternal && (
                  <ToolbarActionButton
                    icon={ExternalLinkIcon}
                    title={t('workingPanel.localFile.preview.openExternal')}
                    onClick={handleOpenExternal}
                  />
                )}
                <PublishHtmlArtifactTrigger />
              </>
            }
          />
          <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
            {/* The rendered-markdown branch scrolls here; the HTML preview and
                the code editor each own their scrolling, and the editor needs
                that so its gutter and status bar stay pinned. */}
            <div style={{ flex: 1, minHeight: 0, overflow: showSourceView ? 'hidden' : 'auto' }}>
              {isMarkdown && mode === 'render' ? (
                <>
                  <SkillFrontmatterPreviewCard metadata={frontmatterMetadata} />
                  <Markdown
                    components={markdownComponents}
                    style={{ paddingBlock: 8, paddingInline: 12 }}
                  >
                    {body}
                  </Markdown>
                </>
              ) : showHtmlPreview ? (
                <InlineHtmlPreview
                  baseUrl={resourceBaseUrl}
                  content={editingValue}
                  key={`${filePath}:${htmlPreviewRevision}`}
                />
              ) : (
                <CodeEditorPane
                  showStatusBar
                  filePath={filePath}
                  readOnly={readOnly}
                  value={editingValue}
                  onChange={readOnly ? undefined : handleCodeChange}
                  onSave={readOnly ? undefined : handleSave}
                />
              )}
            </div>
          </Flexbox>
        </Flexbox>
      </PublishHtmlArtifactProvider>
    );
  },
);

TextPreviewPane.displayName = 'TextPreviewPane';

// ============== ActiveFileView ==============

interface ActiveFileViewProps {
  activeTopicId?: string | null;
  allowExternalFilePreview?: boolean;
  deviceId?: string;
  filePath: string;
  /** Read the file live from the topic's cloud sandbox instead of a filesystem. */
  sandboxTopicId?: string;
  workingDirectory: string;
}

const ActiveFileView = memo<ActiveFileViewProps>(
  ({
    activeTopicId,
    allowExternalFilePreview,
    deviceId,
    filePath,
    sandboxTopicId,
    workingDirectory,
  }) => {
    const { t } = useTranslation('chat');

    const filename = filePath.split('/').at(-1) ?? '';
    const enabled = sandboxTopicId ? true : Boolean(workingDirectory) && (!!deviceId || isDesktop);
    const target = useMemo(
      () => ({
        allowExternalFile: allowExternalFilePreview,
        deviceId,
        filePath,
        sandboxTopicId,
        workingDirectory,
      }),
      [allowExternalFilePreview, deviceId, filePath, sandboxTopicId, workingDirectory],
    );
    const [useFetchPreview, beginSave, refreshPreview] = useLocalFilePreviewStore((s) => [
      s.useFetchPreview,
      s.beginSave,
      s.refreshPreview,
    ]);
    const { error, isHydrated, isLoading, isValidating } = useFetchPreview(target, enabled);
    const preview = useLocalFilePreview(enabled ? target : undefined);

    const handleSaveStart = useCallback(() => beginSave(target), [beginSave, target]);

    const handleReload = useCallback(() => refreshPreview(target), [refreshPreview, target]);

    // The persisted preview is still being read: paint nothing rather than a
    // spinner that the cached text replaces a few frames later.
    if (isLoading) return isHydrated ? <Loading /> : null;

    // Text previews are persisted (stale-while-revalidate): a transiently failed
    // background refresh keeps the cached text, while a deleted / denied file
    // evicts it in the store (so `preview` is gone). Any other preview type surfaces the error
    // (a deleted file / disconnected device), and so does a sandbox — a recycled
    // sandbox has no file left to show.
    if (!preview || (error && (sandboxTopicId || preview.type !== 'text'))) {
      return (
        <Center height={'100%'} width={'100%'}>
          <Empty
            description={t(
              sandboxTopicId
                ? 'workingPanel.localFile.sandboxUnavailable'
                : 'workingPanel.localFile.error',
            )}
          />
        </Center>
      );
    }

    if (preview.type === 'image') {
      return <ImagePreview blob={preview.blob} filename={filename} />;
    }

    if (preview.type === 'video') {
      return (
        <VideoPreview
          allowExternalFile={allowExternalFilePreview}
          filePath={filePath}
          key={filePath}
          revision={preview.revision}
          workingDirectory={workingDirectory}
        />
      );
    }

    if (preview.type === 'document') {
      return (
        <Suspense fallback={<Loading />}>
          {/* Key by source + path: without a remount, switching between two files of
              the same document type reuses the pane instance, whose local
              loading/parse state isn't reset on blob change — the previous file's
              rendered content lingers until the new one finishes. */}
          <DocumentPreview
            blob={preview.blob}
            contentType={preview.contentType}
            filePath={filePath}
            isLocalFile={!sandboxTopicId && !deviceId && isDesktop}
            key={`${sandboxTopicId ?? deviceId ?? 'local'}:${filePath}`}
          />
        </Suspense>
      );
    }

    if (preview.type !== 'text') {
      return (
        <UnsupportedPreview
          filePath={filePath}
          isLocalFile={!sandboxTopicId && !deviceId && isDesktop}
          oversized={preview.type === 'binary' && preview.oversized}
        />
      );
    }

    const ext = getFileExtension(filename);

    return (
      <TextPreviewPane
        activeTopicId={activeTopicId}
        content={preview.content}
        contentType={preview.contentType}
        deviceId={deviceId}
        ext={ext}
        filePath={filePath}
        // Remote files are now editable: saveLocalFile routes the write to the
        // device over RPC (writeProjectFile) just as local files go through IPC.
        // Sandbox files stay read-only — there is no write-back transport.
        readOnly={!!sandboxTopicId}
        reloading={isValidating}
        resourceBaseUrl={preview.resourceBaseUrl}
        sandboxTopicId={sandboxTopicId}
        workingDirectory={workingDirectory}
        onReload={handleReload}
        onSaveStart={handleSaveStart}
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
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  useEffect(() => {
    if (openLocalFiles.length > 0 && activeFile) return;

    clearPortalStack();
  }, [activeFile, clearPortalStack, openLocalFiles.length]);

  if (openLocalFiles.length === 0) return null;
  if (!activeFile) return null;

  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
      <ActiveFileView
        activeTopicId={activeTopicId}
        allowExternalFilePreview={activeFile.allowExternalFilePreview}
        deviceId={activeFile.deviceId}
        filePath={activeFile.filePath}
        sandboxTopicId={activeFile.sandboxTopicId}
        workingDirectory={activeFile.workingDirectory}
      />
    </Flexbox>
  );
});

Body.displayName = 'LocalFileBody';

export default Body;

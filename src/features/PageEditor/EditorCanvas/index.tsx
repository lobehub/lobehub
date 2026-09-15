'use client';

import {
  type AnnotationBubbleContext,
  type AnnotationClickContext,
  type AnnotationComposerContext,
  type CapturedCollaborativeRewriteSelection,
  createWebSocketYjsProvider,
  IAISessionService,
  type IEditor,
  IEditorDiagnosticsService,
  IYjsService,
  type LinkEmbedRule,
  OPEN_ANNOTATION_COMPOSER_COMMAND,
  ReactArtifactPlugin,
  ReactBlockPlugin,
  ReactCollapsiblePlugin,
  ReactLinkPlugin,
  ReactNodePropertiesPlugin,
  ReactTocPlugin,
  ReactYjsPlugin,
  type YjsProviderFactory,
} from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { Block } from '@lobehub/ui';
import { Alert, Button, toast } from '@lobehub/ui/base-ui';
import { Card, Space, Typography } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { MessageSquarePlusIcon, SparklesIcon } from 'lucide-react';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { mentionFilledClassName } from '@/features/ChatInput/InputEditor/mentionStyle';
import type { ComposerTarget } from '@/features/Conversation/types';
import { EditorCanvas as SharedEditorCanvas } from '@/features/EditorCanvas';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/pageAgentRuntime';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import { usePageEditorEditorLifecycle } from '../PageEditorProvider';
import { usePageEditorStore } from '../store';
import { usePageEditable } from '../usePageEditable';
import { isPageAcceptanceEmbedEnabled, matchesPageAcceptanceEmbed } from './acceptanceEmbed';
import { createPageArtifactPluginProps } from './artifactConfig';
import { createPageAwarenessLabelFormatter } from './collaborationAwarenessLabel';
import {
  getPageCollaborationErrorPresentation,
  PAGE_COLLABORATION_SHOULD_BOOTSTRAP,
  type PageCollaborationFatalError,
  subscribePageCollaborationProvider,
  usePageCollaborationEditorLifecycle,
} from './collaborationLifecycle';
import {
  getPageCollaborationBrowserTicketRefreshDelay,
  issuePageCollaborationBrowserTicket,
  type PageCollaborationBrowserTicket,
  shouldRetainPageCollaborationBrowserTicket,
} from './collaborationTicket';
import { resolveYjsWebSocketUrl } from './collaborationUrl';
import { resolveCollaborationUser } from './collaborationUser';
import PageRichLinkCard from './PageRichLinkCard';
import PageScrollAnchoringPlugin from './PageScrollAnchoringPlugin';
import { handleRewriteToolbarClick, shouldRenderRewriteToolbarItem } from './rewriteToolbar';
import { useAskCopilotItem } from './useAskCopilotItem';
import { useDocumentMentionOption } from './useDocumentMentionOption';
import { useSlashItems } from './useSlashItems';

const PAGE_EDITOR_WRAPPER_STYLE: CSSProperties = { overflow: 'visible' };

const toolbarStyles = createStaticStyles(({ css }) => ({
  rewrite: css`
    border-radius: 6px;
    color: ${cssVar.colorTextDescription};

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
}));

const getUrlCardPayload = async (url: string) => {
  const { getBusinessTrpcHeaders } = await import('@/business/client/trpc-headers');
  const response = await fetch(`/webapi/url-metadata?url=${encodeURIComponent(url)}`, {
    headers: await getBusinessTrpcHeaders(),
  });
  if (!response.ok) throw new Error(`URL metadata request failed with ${response.status}`);
  return (await response.json()) as {
    description?: string;
    icon?: string;
    title?: string;
    url?: string;
  };
};

const createPageEmbedRule = (iframeTitle: string, enabled: boolean): LinkEmbedRule => ({
  allowBlockCard: true,
  allowCard: true,
  allowIframe: true,
  getCardPayload: getUrlCardPayload,
  getIframePayload: (url) => ({
    src: url,
    title: iframeTitle,
    url,
  }),
  id: 'page-acceptance-embed',
  match: (url) =>
    matchesPageAcceptanceEmbed(
      url,
      typeof window === 'undefined' ? undefined : window.location,
      enabled,
    ),
});

const genericPageCardRule: LinkEmbedRule = {
  allowBlockCard: true,
  allowCard: true,
  getCardPayload: getUrlCardPayload,
  id: 'page-url-metadata',
  match: (url) => /^https?:\/\//.test(url),
};

type RefreshableYjsProviderOptions = Parameters<typeof createWebSocketYjsProvider>[2] & {
  refreshTicket?: () => Promise<string> | string;
};

const createYjsProviderFactory = (
  wsBaseUrl: string,
  browserTicket: PageCollaborationBrowserTicket,
  refreshTicket: () => Promise<PageCollaborationBrowserTicket>,
): YjsProviderFactory => {
  const providerOptions: RefreshableYjsProviderOptions = {
    documentId: browserTicket.documentId,
    legacyProtocol: false,
    refreshTicket: async () => (await refreshTicket()).ticket,
    ticket: browserTicket.ticket,
    wsBaseUrl,
  };

  // `refreshTicket` is consumed by the editor package's provider lifecycle.
  // Keep this cast at the package boundary so this worktree still type-checks
  // against an older preview d.ts; the runtime option is honored by PR #198.
  return (id, yjsDocMap) =>
    createWebSocketYjsProvider(
      id,
      yjsDocMap,
      providerOptions as Parameters<typeof createWebSocketYjsProvider>[2],
    );
};

interface EditorCanvasProps {
  activeAnnotationIds?: readonly string[];
  askCopilotTarget?: ComposerTarget;
  onAnnotationClick?: (context: AnnotationClickContext) => void;
  onComposerChange?: (context: AnnotationComposerContext | null) => void;
  onRewriteSelection?: (selection: CapturedCollaborativeRewriteSelection) => void;
  placeholder?: string;
  rootClassName?: string;
  style?: CSSProperties;
}

type EditorPlugins = NonNullable<Parameters<typeof Editor>[0]['plugins']>;

const AnnotationBubble = ({ close, records }: AnnotationBubbleContext) => {
  const { t } = useTranslation('editor');

  return (
    <Card
      size="small"
      style={{ maxWidth: 360, width: 320 }}
      title={t('annotation.title')}
      extra={
        <Button size="small" type="text" onClick={close}>
          {t('annotation.close')}
        </Button>
      }
    >
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        {records.map((record) => {
          const payload = record.payload as { text?: string } | string | null;
          const text =
            typeof payload === 'string'
              ? payload
              : typeof payload?.text === 'string'
                ? payload.text
                : t('annotation.invalidPayload');
          return <Typography.Text key={record.id}>{text}</Typography.Text>;
        })}
      </Space>
    </Card>
  );
};

interface EditorDiagnosticsService {
  clear: () => void;
  getEntries: () => readonly object[];
  setEnabled: (enabled: boolean) => void;
}

interface EditorDiagnosticsBarProps {
  editor?: IEditor;
  requested: boolean;
}

const copyDiagnosticsSnapshot = async (snapshot: string): Promise<boolean> => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(snapshot);
      return true;
    } catch {
      // Fall through to the synchronous browser clipboard command.
    }
  }

  const activeElement = document.activeElement as HTMLElement | null;
  const textarea = document.createElement('textarea');
  let copiedSynchronously = false;

  try {
    textarea.value = snapshot;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.insetInlineStart = '-10000px';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    copiedSynchronously = document.execCommand('copy');
  } catch {
    // Keep the failure result from the synchronous clipboard command.
  } finally {
    textarea.remove();
    if (activeElement?.isConnected) activeElement.focus({ preventScroll: true });
  }

  return copiedSynchronously;
};

const EditorDiagnosticsBar = memo<EditorDiagnosticsBarProps>(({ editor, requested }) => {
  const [recording, setRecording] = useState(true);
  const [service, setService] = useState<EditorDiagnosticsService | null>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotText, setSnapshotText] = useState('');
  const serviceRef = useRef<EditorDiagnosticsService | null>(null);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  useEffect(() => {
    if (!requested || !editor) {
      serviceRef.current?.setEnabled(false);
      serviceRef.current = null;
      setService(null);
      setRecording(true);
      setSnapshotOpen(false);
      setSnapshotText('');
      return;
    }

    let disposed = false;
    const bind = () => {
      if (disposed || !editor.getLexicalEditor()) return;

      let next: EditorDiagnosticsService;
      try {
        next = editor.requireService(IEditorDiagnosticsService) as EditorDiagnosticsService;
      } catch {
        return;
      }
      if (
        !next ||
        typeof next.clear !== 'function' ||
        typeof next.getEntries !== 'function' ||
        typeof next.setEnabled !== 'function'
      ) {
        return;
      }

      serviceRef.current = next;
      setService(next);
      next.setEnabled(recordingRef.current);
    };
    const handleInitialized = () => bind();

    editor.on('initialized', handleInitialized);
    bind();

    return () => {
      disposed = true;
      editor.off('initialized', handleInitialized);
      serviceRef.current?.setEnabled(false);
      serviceRef.current = null;
      setService(null);
      setSnapshotOpen(false);
      setSnapshotText('');
    };
  }, [editor, requested]);

  useEffect(() => {
    serviceRef.current?.setEnabled(requested && recording);
  }, [recording, requested]);

  const handleCopy = useCallback(async () => {
    const current = serviceRef.current;
    if (!current) return;

    let entries: readonly object[];
    let snapshot: string;
    try {
      entries = current.getEntries();
      snapshot = JSON.stringify(entries, null, 2);
    } catch {
      toast.error('复制诊断日志失败');
      return;
    }

    try {
      if (!(await copyDiagnosticsSnapshot(snapshot))) throw new Error('copy failed');
      toast.success(`诊断日志已复制（${entries.length}条）`);
    } catch {
      toast.error('复制诊断日志失败');
    }
  }, []);

  const handleClear = useCallback(() => {
    const current = serviceRef.current;
    if (!current) return;

    try {
      current.clear();
      const entries = current.getEntries();
      if (snapshotOpen) setSnapshotText(JSON.stringify(entries, null, 2));
      toast.success(`诊断日志已清空（${entries.length}条）`);
    } catch {
      toast.error('清空诊断日志失败');
    }
  }, [snapshotOpen]);

  const handleView = useCallback(() => {
    const current = serviceRef.current;
    if (!current) return;

    try {
      setSnapshotText(JSON.stringify(current.getEntries(), null, 2));
      setSnapshotOpen(true);
    } catch {
      toast.error('读取诊断日志失败');
    }
  }, []);

  if (!requested) return null;

  return (
    <div
      data-testid="editor-diagnostics"
      style={{
        alignItems: 'center',
        background: cssVar.colorBgContainer,
        border: `1px solid ${cssVar.colorBorder}`,
        borderRadius: 8,
        color: cssVar.colorText,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        marginBlock: 8,
        maxWidth: '100%',
        padding: '4px 6px',
      }}
    >
      <strong style={{ fontSize: 12, marginInline: 4 }}>编辑器诊断</strong>
      <Button
        disabled={!service}
        size="small"
        style={{ color: cssVar.colorText }}
        type="text"
        onClick={() => setRecording((current) => !current)}
      >
        {recording ? '暂停记录' : '继续记录'}
      </Button>
      <Button
        disabled={!service}
        size="small"
        style={{ color: cssVar.colorText }}
        type="text"
        onClick={handleClear}
      >
        清空日志
      </Button>
      <Button
        disabled={!service}
        size="small"
        style={{ color: cssVar.colorText }}
        type="text"
        onClick={handleView}
      >
        查看日志
      </Button>
      <Button
        disabled={!service}
        size="small"
        style={{ color: cssVar.colorText }}
        type="text"
        onClick={() => void handleCopy()}
      >
        复制日志
      </Button>
      {snapshotOpen && (
        <div style={{ flexBasis: '100%', minWidth: 0 }}>
          <textarea
            readOnly
            aria-label="编辑器诊断日志快照"
            rows={8}
            value={snapshotText}
            style={{
              background: cssVar.colorBgContainer,
              border: `1px solid ${cssVar.colorBorderSecondary}`,
              color: cssVar.colorText,
              display: 'block',
              maxWidth: '100%',
              width: '100%',
            }}
          />
          <Button
            size="small"
            style={{ color: cssVar.colorText }}
            type="text"
            onClick={() => setSnapshotOpen(false)}
          >
            关闭
          </Button>
        </div>
      )}
    </div>
  );
});

const EditorCanvas = memo<EditorCanvasProps>((props) => {
  const {
    activeAnnotationIds,
    askCopilotTarget,
    onAnnotationClick,
    onComposerChange,
    onRewriteSelection,
    placeholder,
    rootClassName,
    style,
  } = props;
  const { t } = useTranslation(['editor', 'file', 'ui']);
  const [searchParams] = useSearchParams();
  const editable = usePageEditable();

  const storeEditor = usePageEditorStore((s) => s.editor);
  const pageEditorEditorLifecycle = usePageEditorEditorLifecycle();
  const editor = pageEditorEditorLifecycle?.editor ?? storeEditor;
  const documentId = usePageEditorStore((s) => s.documentId);
  const collaborationDisplayName = useUserStore(userProfileSelectors.displayUserName);
  const collaborationUserId = useUserStore(userProfileSelectors.userId);
  const collaborationUser = useMemo(
    () =>
      resolveCollaborationUser({
        displayName: collaborationDisplayName,
        userId: collaborationUserId,
      }),
    [collaborationDisplayName, collaborationUserId],
  );
  const collaborationUrl = resolveYjsWebSocketUrl(
    typeof window === 'undefined' ? undefined : window.location,
    process.env.NEXT_PUBLIC_PAGE_COLLABORATION_URL,
  );
  const [browserTicket, setBrowserTicket] = useState<PageCollaborationBrowserTicket | null>(null);
  const [browserTicketError, setBrowserTicketError] = useState<Error | null>(null);
  const [providerHasSynced, setProviderHasSynced] = useState(false);
  const [providerHasSyncedOnce, setProviderHasSyncedOnce] = useState(false);
  const [providerError, setProviderError] = useState<PageCollaborationFatalError | null>(null);
  const browserTicketRef = useRef<PageCollaborationBrowserTicket | null>(null);
  const providerFactoryRef = useRef<{ factory: YjsProviderFactory; key: string } | null>(null);

  const refreshBrowserTicket = useCallback(async (): Promise<PageCollaborationBrowserTicket> => {
    if (!documentId) {
      throw new Error('Cannot refresh a browser collaboration ticket without a document.');
    }

    const nextTicket = await issuePageCollaborationBrowserTicket(documentId);
    browserTicketRef.current = nextTicket;
    setBrowserTicket(nextTicket);
    return nextTicket;
  }, [documentId]);

  useEffect(() => {
    let active = true;
    let activeTicket = browserTicketRef.current;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let failureCount = 0;

    const loadTicket = async () => {
      if (!documentId || !collaborationUrl) {
        if (active) {
          browserTicketRef.current = null;
          setBrowserTicket(null);
          setBrowserTicketError(null);
        }
        return;
      }
      // Keep a valid provider alive while a workspace lock temporarily makes
      // the editor read-only. If no ticket exists yet, wait for editability and
      // this effect will rerun when the lock clears.
      if (!editable && !activeTicket) return;

      try {
        const nextTicket = await issuePageCollaborationBrowserTicket(documentId);
        if (!active) return;
        failureCount = 0;
        activeTicket = nextTicket;
        browserTicketRef.current = nextTicket;
        setBrowserTicket(nextTicket);
        setBrowserTicketError(null);

        // Re-fetch shortly before expiry so the provider's reconnect callback
        // always has a recently issued capability for a long-lived Page tab.
        // The provider factory itself remains stable.
        const refreshIn = getPageCollaborationBrowserTicketRefreshDelay(nextTicket.expiresAt);
        refreshTimer = setTimeout(() => void loadTicket(), refreshIn);
      } catch (error) {
        if (!active) return;
        failureCount += 1;
        // A transient refresh failure must not tear down a still-valid Yjs
        // provider. Keep the current ticket until it expires; only the initial
        // failure or an actually expired ticket clears collaboration.
        if (!shouldRetainPageCollaborationBrowserTicket(activeTicket)) {
          activeTicket = null;
          browserTicketRef.current = null;
          setBrowserTicket(null);
        }
        setBrowserTicketError(error instanceof Error ? error : new Error(String(error)));
        const retryIn = Math.min(60_000, 5_000 * 2 ** Math.min(failureCount - 1, 4));
        refreshTimer = setTimeout(() => void loadTicket(), retryIn);
      }
    };

    void loadTicket();
    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [collaborationUrl, documentId, editable]);

  const providerFactoryKey =
    documentId && collaborationUrl
      ? `${documentId}\u0000${collaborationUrl}\u0000${collaborationUserId ?? ''}`
      : null;
  if (providerFactoryRef.current?.key !== providerFactoryKey) {
    providerFactoryRef.current = null;
  }
  if (!providerFactoryRef.current && providerFactoryKey && browserTicket && collaborationUrl) {
    providerFactoryRef.current = {
      factory: createYjsProviderFactory(collaborationUrl, browserTicket, refreshBrowserTicket),
      key: providerFactoryKey,
    };
  }
  const yjsProviderFactory = providerFactoryRef.current?.factory;
  const browserTicketMatchesDocument = Boolean(
    browserTicket &&
    browserTicket.documentId === documentId &&
    browserTicket.roomId === documentId &&
    shouldRetainPageCollaborationBrowserTicket(browserTicket),
  );
  const providerLifecycleRequired = Boolean(documentId && collaborationUrl && editable);

  useEffect(() => {
    let disposed = false;
    let unsubscribeProvider: (() => void) | undefined;
    const initialState = { error: null, hasSynced: false, hasSyncedOnce: false };
    setProviderHasSynced(initialState.hasSynced);
    setProviderHasSyncedOnce(initialState.hasSyncedOnce);
    setProviderError(initialState.error);

    if (!providerLifecycleRequired || !editor) return;

    const bindProvider = () => {
      if (disposed || unsubscribeProvider) return;
      let service: { subscribe: (listener: (state: any) => void) => () => void } | null = null;
      try {
        service = editor.requireService(IYjsService) as typeof service;
      } catch {
        return;
      }
      if (!service) return;
      unsubscribeProvider = subscribePageCollaborationProvider(service, (state) => {
        if (disposed) return;
        setProviderHasSynced(state.hasSynced);
        setProviderHasSyncedOnce(state.hasSyncedOnce);
        setProviderError(state.error);
      });
    };

    const onInitialized = () => bindProvider();
    editor.on('initialized', onInitialized);
    bindProvider();

    return () => {
      disposed = true;
      editor.off('initialized', onInitialized);
      unsubscribeProvider?.();
    };
  }, [editor, providerLifecycleRequired]);

  const collaborationLifecycle = usePageCollaborationEditorLifecycle({
    collaborationUrl,
    documentId,
    editable,
    hasProviderFactory: Boolean(yjsProviderFactory),
    hasValidBrowserTicket: browserTicketMatchesDocument,
    providerError,
    providerHasSynced,
    providerHasSyncedOnce,
    resetEditor: pageEditorEditorLifecycle?.resetEditor,
    userId: collaborationUserId,
  });
  const effectiveEditable = editable && collaborationLifecycle.editable;
  const collaborationEnabled = collaborationLifecycle.collaborationEnabled;
  const collaborationRequired = collaborationLifecycle.collaborationRequired;
  const acceptanceEmbedEnabled = isPageAcceptanceEmbedEnabled();

  // Publish the body ownership boundary before ReactEditor mounts the Yjs
  // provider. Connecting, reconnecting, and fatal room states remain
  // collaboration-required and therefore fail closed for server echoes.
  useLayoutEffect(() => {
    pageAgentRuntime.setCollaborationRequired(collaborationRequired);
  }, [collaborationRequired]);

  useEffect(() => {
    if (browserTicketError) {
      console.warn('[PageEditor] browser collaboration ticket unavailable', browserTicketError);
    }
  }, [browserTicketError]);

  useEffect(() => {
    const service = editor?.requireService(IAISessionService);
    service?.clearSessionFocus();
    service?.setHoveredSessionId(null);
  }, [documentId, editor]);

  const slashItems = useSlashItems({
    documentId,
    onRewriteSelection,
  });
  const askCopilotItem = useAskCopilotItem(editor, askCopilotTarget);
  const mentionOption = useDocumentMentionOption();
  const handleRewriteToolbarActivate = useCallback(() => {
    if (!editor || !documentId || !onRewriteSelection) return false;
    return handleRewriteToolbarClick({
      documentId,
      editor,
      requireRelative: true,
      onSelection: onRewriteSelection,
      onUnavailable: () => toast.error(t('copilot.rewrite.selectionUnavailable')),
    });
  }, [documentId, editor, onRewriteSelection, t]);
  const awarenessLabelFormatter = useMemo(
    () => createPageAwarenessLabelFormatter((key) => t(key, { ns: 'editor' })),
    [t],
  );

  const extraPlugins = useMemo(() => {
    const plugins: EditorPlugins = [
      Editor.withProps(ReactArtifactPlugin, {
        ...createPageArtifactPluginProps({
          code: t('artifact.code', { ns: 'editor' }),
          codeOnly: t('artifact.codeOnly', { ns: 'editor' }),
          preview: t('artifact.preview', { ns: 'editor' }),
          previewOnly: t('artifact.previewOnly', { ns: 'editor' }),
          splitView: t('artifact.splitView', { ns: 'editor' }),
          title: t('artifact.title', { ns: 'editor' }),
          viewMode: t('artifact.viewMode', { ns: 'editor' }),
        }),
      }),
      Editor.withProps(ReactNodePropertiesPlugin, {
        activeAnnotationIds,
        annotationStorageMode: 'external',
        readOnly: !effectiveEditable,
        onAnnotationClick,
        renderAnnotationBubble: (context: AnnotationBubbleContext) => (
          <AnnotationBubble {...context} />
        ),
        onComposerChange,
      } as unknown as Parameters<typeof ReactNodePropertiesPlugin>[0]),
      Editor.withProps(ReactBlockPlugin, { anchorPadding: 0, rootClassName }),
      ReactCollapsiblePlugin,
      ReactTocPlugin,
    ];

    if (collaborationEnabled) {
      plugins.push(
        Editor.withProps(PageScrollAnchoringPlugin, {
          enabled: effectiveEditable,
        }),
      );
    }

    if (documentId && collaborationUrl && yjsProviderFactory && collaborationEnabled) {
      plugins.push(
        Editor.withProps(ReactYjsPlugin, {
          awarenessData: { userId: collaborationUser.userId },
          awarenessLabelFormatter,
          cursorColor: collaborationUser.color,
          id: documentId,
          providerFactory: yjsProviderFactory,
          // Page JSON is a host-side initial render only. The collaboration
          // relay is seeded from the authoritative document snapshot, so a
          // browser must hydrate from the room and never bootstrap that JSON
          // back into Yjs (which would merge a second copy after relay restart).
          shouldBootstrap: PAGE_COLLABORATION_SHOULD_BOOTSTRAP,
          username: collaborationUser.name,
        }),
      );
    }

    return plugins;
  }, [
    collaborationUrl,
    collaborationEnabled,
    collaborationUser,
    documentId,
    effectiveEditable,
    activeAnnotationIds,
    onAnnotationClick,
    onComposerChange,
    rootClassName,
    t,
    yjsProviderFactory,
    awarenessLabelFormatter,
  ]);

  const toolbarItems = useMemo(
    () => [
      ...(askCopilotItem || []),
      ...(shouldRenderRewriteToolbarItem({
        collaborationEnabled,
        documentId,
        effectiveEditable,
        onRewriteSelection,
      })
        ? [
            {
              children: (
                <Block
                  clickable
                  horizontal
                  align="center"
                  className={toolbarStyles.rewrite}
                  gap={8}
                  paddingBlock={6}
                  paddingInline={12}
                  variant="borderless"
                  onClick={handleRewriteToolbarActivate}
                >
                  <SparklesIcon aria-hidden="true" size={16} />
                  <span>{t('copilot.rewrite.toolbar')}</span>
                </Block>
              ),
              key: 'rewrite-agent',
              label: t('copilot.rewrite.toolbar'),
            },
          ]
        : []),
      {
        icon: MessageSquarePlusIcon,
        key: 'annotation-comment',
        label: t('annotation.toolbar'),
        onClick: () => {
          editor?.dispatchCommand(OPEN_ANNOTATION_COMPOSER_COMMAND, {
            kind: 'comment',
            payload: null,
          });
        },
      },
    ],
    [
      askCopilotItem,
      documentId,
      editor,
      collaborationEnabled,
      effectiveEditable,
      handleRewriteToolbarActivate,
      onRewriteSelection,
      t,
    ],
  );

  const linkPlugin = useMemo(
    () =>
      Editor.withProps(ReactLinkPlugin, {
        defaultToolbarItems: true,
        labels: {
          convertToBlockCard: t('link.convertToBlockCard', { ns: 'editor' }),
          convertToCard: t('link.convertToCard', { ns: 'editor' }),
          convertToIframe: t('link.convertToIframe', { ns: 'editor' }),
          convertToLink: t('link.convertToLink', { ns: 'editor' }),
          convertToSchema: t('link.convertToSchema', { ns: 'editor' }),
        },
        linkEmbedRules: [
          ...(acceptanceEmbedEnabled
            ? [createPageEmbedRule(t('link.iframeTitle', { ns: 'editor' }), acceptanceEmbedEnabled)]
            : []),
          genericPageCardRule,
        ],
        renderLinkCard: (props) => <PageRichLinkCard {...props} />,
      }),
    [acceptanceEmbedEnabled, t],
  );
  const collaborationErrorPresentation = collaborationLifecycle.collaborationError
    ? getPageCollaborationErrorPresentation(collaborationLifecycle.collaborationError.code)
    : null;

  return (
    <>
      {collaborationLifecycle.collaborationError && collaborationErrorPresentation && (
        <Alert
          showIcon
          description={`${t(collaborationErrorPresentation.descriptionKey, { ns: 'file' })} ${collaborationLifecycle.collaborationError.code}: ${collaborationLifecycle.collaborationError.message}`}
          style={{ marginBlock: 8 }}
          title={t(collaborationErrorPresentation.titleKey, { ns: 'file' })}
          type={collaborationErrorPresentation.type}
        />
      )}
      <SharedEditorCanvas
        className={mentionFilledClassName}
        collaborationEnabled={collaborationEnabled}
        collaborationRequired={collaborationRequired}
        documentId={documentId}
        editable={effectiveEditable}
        editor={editor}
        extraPlugins={extraPlugins}
        key={pageEditorEditorLifecycle?.generation ?? 0}
        linkPlugin={linkPlugin}
        mentionOption={mentionOption}
        placeholder={placeholder || t('pageEditor.editorPlaceholder', { ns: 'file' })}
        slashItems={slashItems}
        style={style}
        toolbarExtraItems={effectiveEditable ? toolbarItems : undefined}
        wrapperStyle={PAGE_EDITOR_WRAPPER_STYLE}
        unsavedChangesGuard={{
          enabled: true,
          message: t('form.unsavedWarning', { ns: 'ui' }),
          title: t('form.unsavedChanges', { ns: 'ui' }),
        }}
      />
      <EditorDiagnosticsBar
        editor={editor}
        requested={searchParams.get('editorDiagnostics') === '1'}
      />
    </>
  );
});

export default EditorCanvas;

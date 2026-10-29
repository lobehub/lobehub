import { IYjsService, ReactYjsPlugin } from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { confirmModal } from '@lobehub/ui';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';

import { analyticsClient } from '@/libs/analytics/client';
import { getGatewayMux } from '@/store/chat/slices/agentRun/actions/transports/gateway/muxRegistry';
import { useDocumentStore } from '@/store/document';
import { registerPageCollab } from '@/store/document/collabRegistry';
import { pageActions } from '@/store/page';
import { getServerConfigStoreState } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { usePageEditorStore, useStoreApi } from '../store';
import { PageCollabProvider } from './provider';

const PAGE_META_KEY = 'meta';

const offlineSnapshots = new Map<string, unknown>();

// The page list reads the DB row, which the room projects ~2s after a change.
// ponytail: fixed delay, push the projected title over resource events if it lags.
const PAGE_LIST_REFRESH_DELAY_MS = 3000;

// Deployment-static config, read once like the gateway transport does. Rooms
// exist only where the server enables page collaboration (LobeHub Cloud).
const readGatewayUrl = () => {
  const serverConfig = getServerConfigStoreState()?.serverConfig;
  return serverConfig?.agentGatewayUrl && serverConfig.enablePageCollab
    ? serverConfig.agentGatewayUrl
    : undefined;
};

export const usePageCollabEnabled = () => !!readGatewayUrl();

/**
 * Whether this document edits through a room. A SKILL.md saves its frontmatter
 * alongside the body over HTTP, so it never joins one, which carries the body alone.
 */
export const usePageCollabEligible = (documentId: string | undefined) => {
  const isSkillMarkdown = useDocumentStore((s) =>
    documentId ? s.documents[documentId]?.contentFormat === 'skillMarkdown' : false,
  );
  return usePageCollabEnabled() && !!documentId && !isSkillMarkdown;
};

export const usePageCollab = (documentId: string | undefined, onReset?: () => void) => {
  const { t } = useTranslation('file');
  const storeApi = useStoreApi();
  const enabled = usePageCollabEligible(documentId);
  const gatewayUrl = readGatewayUrl();
  const username = useUserStore(userProfileSelectors.displayUserName);
  const docLoaded = useDocumentStore((s) => (documentId ? !!s.documents[documentId] : false));
  const setDocumentCollab = useDocumentStore((s) => s.setDocumentCollab);
  const collabStatus = usePageEditorStore((s) => s.collab?.status);

  const session = useMemo(() => {
    if (!enabled || !gatewayUrl) return undefined;

    const doc = new Y.Doc();
    const setCollab = (
      next: Partial<NonNullable<ReturnType<typeof storeApi.getState>['collab']>>,
    ) =>
      storeApi.setState((state) => ({
        collab: { access: 'edit', pending: 0, status: 'connecting', ...state.collab, ...next },
      }));

    const provider = new PageCollabProvider(documentId!, doc, getGatewayMux({ gatewayUrl }), {
      onAccess: (access) => setCollab({ access }),
      onBootstrap: () => {
        const editor = storeApi.getState().editor;
        if (editor) void useDocumentStore.getState().onEditorInit(editor, documentId!);
      },
      onPendingChange: (pending) => setCollab({ pending }),
      onReset: (reason) => {
        const editor = storeApi.getState().editor;
        // After a lost bootstrap race the pending edits are the duplicate copy itself.
        if (reason === 'epoch' && provider.pendingCount > 0 && editor) {
          offlineSnapshots.set(documentId!, editor.getDocument('json'));
        }
        onReset?.();
      },
      onFailure: ({ code, elapsedMs }) => {
        void analyticsClient.track({
          name: 'page_collab_sync_failed',
          properties: { code, elapsed_ms: elapsedMs },
        });
      },
      // Until the first sync the page reads "connecting"; a drop only shows
      // once the page was live, while a failure always does.
      onStatus: (status) => {
        const current = storeApi.getState().collab?.status;
        if (
          status === 'synced' ||
          status === 'error' ||
          current === 'synced' ||
          current === 'error'
        ) {
          setCollab({ status });
        }
      },
    });
    setCollab({ retry: () => provider.retry(), status: 'connecting' });

    return { doc, provider };
  }, [enabled, gatewayUrl, documentId, storeApi, onReset]);

  useEffect(() => {
    if (!session) return;
    return () => {
      session.provider.destroy();
      storeApi.setState({ collab: undefined });
    };
  }, [session, storeApi]);

  useEffect(() => {
    if (!session || !documentId || !docLoaded) return;
    setDocumentCollab(documentId, true);
    session.provider.connect();
    const unregister = registerPageCollab(documentId, session.provider);
    return () => {
      unregister();
      setDocumentCollab(documentId, false);
    };
  }, [session, documentId, docLoaded, setDocumentCollab]);

  useEffect(() => {
    if (!session) return;
    const meta = session.doc.getMap(PAGE_META_KEY);
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const onRemoteMeta = (event: Y.YMapEvent<unknown>) => {
      if (event.transaction.local) return;
      const title = meta.get('title');
      if (typeof title !== 'string') return;
      const { emoji, syncMeta } = storeApi.getState();
      syncMeta(title, emoji);
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(
        () => void pageActions.refreshDocuments(),
        PAGE_LIST_REFRESH_DELAY_MS,
      );
    };
    meta.observe(onRemoteMeta);

    const unsubscribe = storeApi.subscribe((state, prev) => {
      if (state.title === prev.title || !state.isMetaDirty || state.title === undefined) return;
      if (meta.get('title') !== state.title) meta.set('title', state.title);
    });

    return () => {
      clearTimeout(refreshTimer);
      meta.unobserve(onRemoteMeta);
      unsubscribe();
    };
  }, [session, storeApi]);

  useEffect(() => {
    if (!session || !documentId || collabStatus !== 'synced') return;
    const snapshot = offlineSnapshots.get(documentId);
    if (!snapshot) return;

    offlineSnapshots.delete(documentId);
    confirmModal({
      cancelText: t('pageEditor.collab.offlineRestore.discard'),
      content: t('pageEditor.collab.offlineRestore.content'),
      okText: t('pageEditor.collab.offlineRestore.restore'),
      onOk: () => {
        storeApi
          .getState()
          .editor?.requireService(IYjsService)
          ?.applyExternalEditorData(snapshot as Record<string, unknown>);
      },
      title: t('pageEditor.collab.offlineRestore.title'),
    });
  }, [session, documentId, collabStatus, storeApi, t]);

  return useMemo(() => {
    if (!session) return undefined;
    return Editor.withProps(ReactYjsPlugin, {
      id: 'page',
      providerFactory: (id: string, docMap: Map<string, Y.Doc>) => {
        docMap.set(id, session.doc);
        return session.provider as any;
      },
      shouldBootstrap: true,
      username,
      yjsDoc: session.doc,
    });
  }, [session, username]);
};

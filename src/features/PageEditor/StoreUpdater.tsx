'use client';

import { memo, useEffect, useRef } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { pageSelectors, usePageStore } from '@/store/page';

import { type PublicState } from './store';
import { usePageEditorStore, useStoreApi } from './store';
import { useDocumentLock } from './useDocumentLock';
import { usePageDraft } from './usePageDraft';
import { useResourceEvents } from './useResourceEvents';

export interface StoreUpdaterProps extends Partial<PublicState> {
  pageId?: string;
}

/**
 * StoreUpdater syncs PageEditorStore props.
 *
 * Note: Document content loading is handled by EditorCanvas via DocumentStore.
 * Title/emoji are consumed from PageEditorStore (set via setCurrentTitle/setCurrentEmoji).
 */
const StoreUpdater = memo<StoreUpdaterProps>(
  ({
    pageId,
    knowledgeBaseId,
    metaReadOnly,
    onDocumentIdChange,
    onEmojiChange,
    onSave,
    onTitleChange,
    onDelete,
    onBack,
    onCollabReset,
    parentId,
    title,
    emoji,
  }) => {
    const storeApi = useStoreApi();
    const useStoreUpdater = createStoreUpdater(storeApi);

    const initMeta = usePageEditorStore((s) => s.initMeta);
    const setDocumentId = usePageEditorStore((s) => s.setDocumentId);
    const syncMeta = usePageEditorStore((s) => s.syncMeta);
    // Workspace pages are view-first; resolve once here so the lock + gating read
    // a single source of truth. Private-visibility pages are creator-only —
    // no other member can open them — so they stay outside the lock lifecycle
    // (mirrors DocumentService.isCollaborativeDocument on the server).
    const isWorkspacePage = usePageStore((s) => {
      const doc = pageSelectors.getDocumentById(pageId)(s);
      return Boolean(doc?.workspaceId) && doc?.visibility !== 'private';
    });

    // Every page that lives in a workspace, private drafts included. Naming a
    // member is about who exists in the workspace, not who can already open the
    // page — and a page created from the sidebar starts as 私人, so gating on
    // `isWorkspacePage` would hide `@` exactly where most pages begin. The
    // server still drops the ping for anyone without view access.
    const isWorkspaceScopedPage = usePageStore((s) =>
      Boolean(pageSelectors.getDocumentById(pageId)(s)?.workspaceId),
    );

    // Drive the collaborative edit lock for workspace pages
    useDocumentLock();
    // Subscribe to realtime doc/lock events so the page syncs without polling
    useResourceEvents();
    // Snapshot unsaved content to sessionStorage while the lock is degraded so
    // an accidental refresh during a network blip doesn't blow away typing.
    usePageDraft();

    // Update store with props
    // `useStoreUpdater` writes the raw field; `documentId` goes through its own
    // action instead, so a panel left open on the previous document doesn't
    // carry over to this one (see setDocumentId).
    useEffect(() => {
      if (typeof pageId !== 'undefined') setDocumentId(pageId);
    }, [pageId, setDocumentId]);
    useStoreUpdater('isWorkspacePage', isWorkspacePage);
    useStoreUpdater('isWorkspaceScopedPage', isWorkspaceScopedPage);
    useStoreUpdater('knowledgeBaseId', knowledgeBaseId);
    useStoreUpdater('metaReadOnly', metaReadOnly);
    useStoreUpdater('onDocumentIdChange', onDocumentIdChange);
    useStoreUpdater('onEmojiChange', onEmojiChange);
    useStoreUpdater('onSave', onSave);
    useStoreUpdater('onTitleChange', onTitleChange);
    useStoreUpdater('onDelete', onDelete);
    useStoreUpdater('onBack', onBack);
    useStoreUpdater('onCollabReset', onCollabReset);
    useStoreUpdater('parentId', parentId);

    // Initialize meta (title/emoji) with dirty tracking once per page. Later
    // prop changes (list refresh after our own save, sidebar rename, realtime
    // sync) go through `syncMeta`, which yields to unsaved local typing — a
    // blind `initMeta` here used to roll the title back mid-keystroke.
    const initializedPageIdRef = useRef<string | undefined>(undefined);
    useEffect(() => {
      if (initializedPageIdRef.current !== pageId) {
        initializedPageIdRef.current = pageId;
        initMeta(title, emoji);
        return;
      }

      syncMeta(title, emoji);
    }, [pageId, title, emoji, initMeta, syncMeta]);

    return null;
  },
);

export default StoreUpdater;

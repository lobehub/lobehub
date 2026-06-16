'use client';

import { confirmModal } from '@lobehub/ui/base-ui';
import debug from 'debug';
import { debounce } from 'es-toolkit/compat';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import { usePageEditorStore } from './store';

const log = debug('page:draft');

const DRAFT_KEY_PREFIX = 'page-draft:';
const DRAFT_WRITE_DEBOUNCE_MS = 200;
/**
 * Drafts older than 24h are treated as stale on open. Past that window the
 * server is almost certainly the source of truth (someone else has edited, or
 * the user has moved on) and silently restoring would be more surprising than
 * helpful.
 */
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface PageDraftPayload {
  documentId: string;
  editorData: unknown;
  ownerId?: string;
  savedAt: string;
}

const draftKey = (documentId: string) => `${DRAFT_KEY_PREFIX}${documentId}`;

const writeDraft = (payload: PageDraftPayload): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(draftKey(payload.documentId), JSON.stringify(payload));
  } catch (error) {
    // sessionStorage may be full / blocked — drop silently. The in-memory editor
    // still has the content; the snapshot is defense in depth, not the primary
    // copy.
    log('failed to write draft for %s: %O', payload.documentId, error);
  }
};

export const clearPageDraft = (documentId: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(draftKey(documentId));
  } catch {
    // ignore
  }
};

export const readPageDraft = (documentId: string): PageDraftPayload | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(draftKey(documentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PageDraftPayload;
    if (parsed?.documentId !== documentId) return null;
    const savedAt = Date.parse(parsed.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > DRAFT_MAX_AGE_MS) {
      clearPageDraft(documentId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

/**
 * Persists a tab-local snapshot of the editor's in-memory content while the
 * collaborative lock is degraded (`unstable` / `lost`), so an accidental
 * refresh or navigation during the lock-loss window doesn't blow away unsaved
 * work. The snapshot is cleared once the lock recovers AND the document is no
 * longer dirty — at that point the server has the latest version and the
 * snapshot is stale by definition.
 *
 * On open, if a recent draft exists and the local editor isn't dirty yet, the
 * user is prompted once to restore it. Declining drops the draft so there's no
 * lingering ghost state.
 */
export const usePageDraft = (): void => {
  const { t } = useTranslation('file');
  const documentId = usePageEditorStore((s) => s.documentId);
  const lockHealth = usePageEditorStore((s) => s.lockHealth);
  const lockOwnerId = usePageEditorStore((s) => s.lockOwnerId);
  const editor = usePageEditorStore((s) => s.editor);

  const editorData = useDocumentStore((s) =>
    documentId ? editorSelectors.editorData(documentId)(s) : undefined,
  );
  const isDirty = useDocumentStore((s) =>
    documentId ? editorSelectors.isDirty(documentId)(s) : false,
  );

  // Stable debounced writer; the latest payload always wins.
  const writer = useMemo(
    () => debounce(writeDraft, DRAFT_WRITE_DEBOUNCE_MS, { leading: false, trailing: true }),
    [],
  );

  // Snapshot on every change while the lock isn't healthy AND there's unsaved
  // work to protect. Skip otherwise — when healthy, the regular save path is
  // the source of truth; when clean, there's nothing worth backing up.
  useEffect(() => {
    if (!documentId) return;
    if (lockHealth === 'healthy' || !isDirty) return;
    writer({
      documentId,
      editorData,
      ownerId: lockOwnerId,
      savedAt: new Date().toISOString(),
    });
  }, [documentId, lockHealth, isDirty, editorData, lockOwnerId, writer]);

  // Drop the snapshot once we recover AND every change has been flushed. At
  // that point the server has the latest content; the snapshot is stale and a
  // leftover would re-prompt the user next time they open the page.
  useEffect(() => {
    if (!documentId) return;
    if (lockHealth === 'healthy' && !isDirty) {
      writer.cancel?.();
      clearPageDraft(documentId);
    }
  }, [documentId, lockHealth, isDirty, writer]);

  // Cancel any pending write on unmount so a snapshot scheduled just before
  // leaving can't race a downstream clean-state clear.
  useEffect(() => () => writer.cancel?.(), [writer]);

  // One-shot restore prompt on open: if we land on a document with a recent
  // draft AND the local editor hasn't started typing, ask whether to restore.
  // Track the prompted documentId so re-renders or editor remounts don't
  // re-trigger the modal.
  const promptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!documentId || !editor) return;
    if (promptedRef.current === documentId) return;
    if (isDirty) return;
    const draft = readPageDraft(documentId);
    if (!draft) return;
    promptedRef.current = documentId;

    void confirmModal({
      cancelText: t('pageEditor.editMode.draftRestoreCancel'),
      content: t('pageEditor.editMode.draftRestoreContent'),
      okText: t('pageEditor.editMode.draftRestoreOk'),
      onCancel: () => clearPageDraft(documentId),
      onOk: () => {
        try {
          if (draft.editorData && typeof draft.editorData === 'object') {
            editor.setDocument('json', JSON.stringify(draft.editorData));
          }
        } catch (error) {
          log('failed to restore draft for %s: %O', documentId, error);
        } finally {
          clearPageDraft(documentId);
        }
      },
      title: t('pageEditor.editMode.draftRestoreTitle'),
    });
  }, [documentId, editor, isDirty, t]);
};

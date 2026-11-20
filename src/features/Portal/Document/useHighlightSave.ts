'use client';

import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@lobechat/const';
import { toast } from '@lobehub/ui';
import { debounce } from 'es-toolkit/compat';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { documentService } from '@/services/document';
import { invalidateDocumentMutation } from '@/services/document/invalidation';
import { useDocumentStore } from '@/store/document';
import {
  type DocumentCharLimitRefusal,
  getCharLimitRefusal,
  notifyCharLimitRefused,
} from '@/store/document/slices/editor/charLimit';

const isConflictError = (error: unknown) =>
  (error as { data?: { code?: string } })?.data?.code === 'CONFLICT';

/**
 * Records (or clears) a save refused by the plan's per-document character limit
 * on the document's store entry, which the portal's limit banner reads.
 */
const setCharLimitError = (id: string, charLimitError: DocumentCharLimitRefusal | undefined) => {
  const { documents, internal_dispatchDocument } = useDocumentStore.getState();
  if (!documents[id] || documents[id].charLimitError === charLimitError) return;
  internal_dispatchDocument({ id, type: 'updateDocument', value: { charLimitError } });
};

/**
 * Drafts the server refused for exceeding the plan's character limit, by
 * document. The editor unmounts when the user opens another document or closes
 * the portal, and would reopen on the persisted body, so the refused text lives
 * here until it is saved, replaced by a newer remote body, or the page unloads.
 * The unload is guarded by {@link guardRefusedDraftsOnExit}, not by the editor's own
 * `beforeunload` listener, which goes away when the editor unmounts.
 */
const refusedDrafts = new Map<
  string,
  { baseUpdatedAt?: number; content: string; refusal: DocumentCharLimitRefusal }
>();

let exitGuardInstalled = false;

/**
 * Warns before the page unloads while any refused draft is still kept. It lives at
 * module level because the drafts outlive the editor: once the portal closes, the
 * editor's listener is gone and a reload would drop the refused text silently.
 */
const guardRefusedDraftsOnExit = () => {
  if (exitGuardInstalled || typeof window === 'undefined') return;
  exitGuardInstalled = true;
  window.addEventListener('beforeunload', (event) => {
    if (refusedDrafts.size === 0) return;
    event.preventDefault();
    event.returnValue = '';
  });
};

/** Test-only: forgets every kept refused draft. */
export const resetRefusedDraftsForTests = () => refusedDrafts.clear();

/**
 * The refused draft to reopen with, if it was written against the version the
 * editor now shows. A draft over an older version is dropped: the remote body
 * replaced it, the same as when the editor is mounted (see the `updatedAt` effect),
 * and `null` is returned so its banner is cleared too.
 */
const takeRefusedDraft = (documentId: string, updatedAt?: Date) => {
  const draft = refusedDrafts.get(documentId);
  if (!draft) return;
  if (draft.baseUpdatedAt === updatedAt?.getTime()) return draft;
  refusedDrafts.delete(documentId);
  return null;
};

export interface UseHighlightSaveParams {
  content: string;
  documentId: string;
  /**
   * Called when a write starts; returns the commit for its confirmed result.
   * The caller captures what the write belongs to (e.g. the active identity)
   * before the request is awaited.
   */
  onSaveStart: () => (content: string, updatedAt?: string) => void;
  updatedAt?: Date;
}

export interface UseHighlightSaveResult {
  editingValue: string;
  handleChange: (next: string) => void;
  handleSave: () => Promise<void>;
}

export const useHighlightSave = ({
  content,
  documentId,
  onSaveStart,
  updatedAt,
}: UseHighlightSaveParams): UseHighlightSaveResult => {
  const { t } = useTranslation('portal');
  const [restored] = useState(() => takeRefusedDraft(documentId, updatedAt));
  const [buffer, setBuffer] = useState<string | undefined>(restored?.content ?? undefined);
  const editingValue = buffer ?? content;

  const bufferRef = useRef(buffer);
  const documentIdRef = useRef(documentId);
  const onSaveStartRef = useRef(onSaveStart);
  const expectedUpdatedAtRef = useRef(updatedAt);
  const baseContentRef = useRef(content);
  const pendingSaveRef = useRef<Promise<void> | undefined>(undefined);
  const tRef = useRef(t);
  bufferRef.current = buffer;
  documentIdRef.current = documentId;
  onSaveStartRef.current = onSaveStart;
  tRef.current = t;

  // Reopening a refused draft shows its banner again (closing the portal drops
  // the document's store entry), or clears it when the draft was dropped.
  // Runs once: `restored` never changes, and the caller keys the editor by document.
  // `undefined` means there was no draft, so the banner is left alone.
  useEffect(() => {
    if (restored === undefined) return;
    setCharLimitError(documentId, restored?.refusal);
  }, [documentId, restored]);

  const saveBuffer = useCallback(async (source: 'manual' | 'autosave') => {
    const toWrite = bufferRef.current;
    if (toWrite === undefined) return;
    const expectedUpdatedAt = expectedUpdatedAtRef.current;
    try {
      const commitSaved = onSaveStartRef.current();
      const result = await documentService.updateDocument({
        content: toWrite,
        id: documentIdRef.current,
        saveSource: source,
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
      });
      if (result?.updatedAt) {
        const savedAt = new Date(result.updatedAt);
        if (expectedUpdatedAtRef.current && savedAt < expectedUpdatedAtRef.current) return;
        expectedUpdatedAtRef.current = savedAt;
      }
      baseContentRef.current = toWrite;
      refusedDrafts.delete(documentIdRef.current);
      setCharLimitError(documentIdRef.current, undefined);
      commitSaved(toWrite, result?.updatedAt);
      if (bufferRef.current === toWrite) {
        bufferRef.current = undefined;
        setBuffer(undefined);
      }
    } catch (error) {
      if (isConflictError(error)) {
        // A newer remote row already reconciled this request's base.
        if (expectedUpdatedAtRef.current?.getTime() !== expectedUpdatedAt?.getTime()) return;
        bufferRef.current = undefined;
        setBuffer(undefined);
        refusedDrafts.delete(documentIdRef.current);
        setCharLimitError(documentIdRef.current, undefined);
        // Refreshes the document's replica entry, which the portal body reads.
        await Promise.allSettled([
          invalidateDocumentMutation({ documentId: documentIdRef.current }),
        ]);
        toast.error(tRef.current('document.saveConflict'));
        return;
      }
      // Keep the buffer: the banner explains why it is unsaved, and the next
      // edit schedules the next attempt.
      const charLimitError = getCharLimitRefusal(error, toWrite.length);
      if (charLimitError) {
        refusedDrafts.set(documentIdRef.current, {
          baseUpdatedAt: expectedUpdatedAt?.getTime(),
          content: toWrite,
          refusal: charLimitError,
        });
        guardRefusedDraftsOnExit();
        setCharLimitError(documentIdRef.current, charLimitError);
        if (source === 'manual') notifyCharLimitRefused(charLimitError);
        return;
      }
      console.error('[HighlightEditor] save failed:', error);
    }
  }, []);

  const writeBuffer = useCallback(
    (source: 'manual' | 'autosave') => {
      const run = (pendingSaveRef.current ?? Promise.resolve()).then(() => saveBuffer(source));
      pendingSaveRef.current = run;
      return run;
    },
    [saveBuffer],
  );

  const debouncedAutoSave = useMemo(
    () =>
      debounce(() => writeBuffer('autosave'), EDITOR_DEBOUNCE_TIME, {
        leading: false,
        maxWait: EDITOR_MAX_WAIT,
        trailing: true,
      }),
    [writeBuffer],
  );

  useEffect(() => {
    const knownVersion = expectedUpdatedAtRef.current;
    if (!updatedAt || (knownVersion && updatedAt <= knownVersion)) return;
    if (content !== baseContentRef.current) {
      debouncedAutoSave.cancel();
      bufferRef.current = undefined;
      setBuffer(undefined);
      // The refused buffer is gone, so its refusal no longer applies.
      refusedDrafts.delete(documentIdRef.current);
      setCharLimitError(documentIdRef.current, undefined);
    }
    baseContentRef.current = content;
    expectedUpdatedAtRef.current = updatedAt;
  }, [content, updatedAt, debouncedAutoSave]);

  const handleChange = useCallback(
    (next: string) => {
      const isDirty = next !== baseContentRef.current;
      bufferRef.current = isDirty ? next : undefined;
      setBuffer(bufferRef.current);
      if (isDirty) {
        debouncedAutoSave();
        return;
      }
      debouncedAutoSave.cancel();
      // Back to the saved body: nothing refused is left to keep or explain.
      refusedDrafts.delete(documentIdRef.current);
      setCharLimitError(documentIdRef.current, undefined);
    },
    [debouncedAutoSave],
  );

  const handleSave = useCallback(async () => {
    debouncedAutoSave.cancel();
    await writeBuffer('manual');
  }, [debouncedAutoSave, writeBuffer]);

  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      debouncedAutoSave.cancel();
      // Defer the fire-and-forget save to a microtask so that StrictMode's synchronous
      // unmount/remount in development does not trigger a save. If the component is
      // immediately remounted, isMountedRef flips back to true before this runs.
      queueMicrotask(() => {
        if (isMountedRef.current) return;
        void writeBuffer('autosave');
      });
    };
  }, [debouncedAutoSave, writeBuffer]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (bufferRef.current === undefined) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  return { editingValue, handleChange, handleSave };
};

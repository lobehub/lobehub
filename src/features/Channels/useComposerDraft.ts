import type { IEditor } from '@lobehub/editor';
import { debounce } from 'es-toolkit/compat';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  getDraftEntry,
  removeDraftIfUnchanged,
  saveDraft,
} from '@/features/ChatInput/draftStorage';
import { canSerialize, readDocument, writeDocument } from '@/features/ChatInput/editorDocument';

const SAVE_DEBOUNCE_MS = 500;

/** The Channel or Thread a composer writes to; never shared with ordinary chat draft keys. */
export const channelDraftKey = (channelId: string, threadId?: string | null) =>
  `channel:${channelId}:${threadId || 'main'}`;

/**
 * Keeps unsent Channel input across Channel/Thread switches and reloads, in the same
 * storage as the chat input. The composer remounts per key, so the key never changes here.
 */
export const useComposerDraft = (editor: IEditor, draftKey: string) => {
  // The stored revision this editor carries; an empty editor removes only that revision.
  const loaded = useRef<number | undefined>(undefined);

  const persist = useCallback(() => {
    // A torn-down editor reads as empty; treating that as a clear would delete the draft.
    if (!canSerialize(editor)) return;
    if (!String(readDocument(editor, 'markdown') ?? '').trim()) {
      if (removeDraftIfUnchanged(draftKey, loaded.current)) loaded.current = undefined;
      return;
    }
    const json = readDocument(editor, 'json');
    if (!json || typeof json !== 'object') return;
    const updatedAt = saveDraft(draftKey, json as Record<string, unknown>);
    if (updatedAt !== undefined) loaded.current = updatedAt;
  }, [draftKey, editor]);

  const save = useMemo(() => debounce(persist, SAVE_DEBOUNCE_MS), [persist]);
  useEffect(() => () => save.flush(), [save]);

  const restore = useCallback(() => {
    if (!canSerialize(editor)) return;
    const draft = getDraftEntry(draftKey);
    loaded.current = draft?.updatedAt;
    if (draft && editor.isEmpty) writeDocument(editor, 'json', draft.json);
  }, [draftKey, editor]);

  /** Saves pending input and returns its stored revision, taken when a send starts. */
  const snapshot = useCallback(() => {
    save.flush();
    return loaded.current;
  }, [save]);

  /**
   * The input from `revision` was sent: drop that draft instead of saving the cleared editor.
   * The key is shared across tabs, so a draft another tab saved meanwhile is kept.
   */
  const clear = useCallback(
    (revision: number | undefined) => {
      save.cancel();
      removeDraftIfUnchanged(draftKey, revision);
      loaded.current = undefined;
    },
    [draftKey, save],
  );

  return { clear, flush: save.flush, restore, save, snapshot };
};

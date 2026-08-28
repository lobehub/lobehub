import type { IEditor } from '@lobehub/editor';
import { debounce } from 'es-toolkit/compat';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { getDraftEntry, removeDraftIfUnchanged, saveDraft } from '../draftStorage';
import { useStoreApi } from '../store';

const SAVE_DEBOUNCE_MS = 500;

export const useChatInputDraft = () => {
  const storeApi = useStoreApi();
  // The storage revision whose document the editor is currently carrying. An
  // empty editor may remove only that revision: before restore it owns none,
  // and after another composer writes the same key its revision is stale.
  const loadedDraftRef = useRef<{ draftKey: string; updatedAt: number | undefined } | undefined>(
    undefined,
  );

  const persistDraftFor = useCallback(
    (draftKey: string, removeEmpty = true) => {
      const { editor, getMarkdownContent, getJSONState } = storeApi.getState();
      if (!editor) return;

      if (getMarkdownContent().trim().length === 0) {
        const loadedDraft = loadedDraftRef.current;
        if (
          removeEmpty &&
          loadedDraft?.draftKey === draftKey &&
          removeDraftIfUnchanged(draftKey, loadedDraft.updatedAt)
        ) {
          loadedDraftRef.current = { draftKey, updatedAt: undefined };
        }
        return;
      }

      const json = getJSONState();
      if (json) {
        const updatedAt = saveDraft(draftKey, json);
        if (updatedAt !== undefined) loadedDraftRef.current = { draftKey, updatedAt };
      }
    },
    [storeApi],
  );

  const saveDraftDebounced = useMemo(
    () =>
      debounce(() => {
        const { draftKey } = storeApi.getState();
        if (draftKey) persistDraftFor(draftKey);
      }, SAVE_DEBOUNCE_MS),
    [persistDraftFor, storeApi],
  );

  // Flush locally scheduled work first so an intentional clear still removes
  // the revision this editor owns. Then save live non-empty content that may
  // not have reached the debounce yet. The unconditional pass must not remove
  // an empty draft: a different composer may have written the shared key.
  useEffect(
    () => () => {
      saveDraftDebounced.flush();
      const { draftKey } = storeApi.getState();
      if (draftKey) persistDraftFor(draftKey, false);
    },
    [persistDraftFor, saveDraftDebounced, storeApi],
  );

  const restoreDraft = useCallback(
    (editor: IEditor) => {
      const { draftKey } = storeApi.getState();
      if (!draftKey) return;

      const draft = getDraftEntry(draftKey);
      loadedDraftRef.current = { draftKey, updatedAt: draft?.updatedAt };

      if (!editor.isEmpty) return;

      if (draft) editor.setDocument('json', draft.json);
    },
    [storeApi],
  );

  // The store instance survives topic switches, so a draftKey change is the
  // conversation boundary: persist under the key the content was typed for
  // (cancelling the pending debounce, which would otherwise save it under the
  // new key), then swap the editor document in place. Focus last — the
  // document swap would drop any focus applied earlier in the switch, and on
  // mobile focusing would pop the keyboard on every switch.
  useEffect(
    () =>
      storeApi.subscribe((state, prevState) => {
        if (state.draftKey === prevState.draftKey) return;

        saveDraftDebounced.cancel();
        if (prevState.draftKey) persistDraftFor(prevState.draftKey);

        const { editor } = state;
        if (!editor) return;
        editor.cleanDocument();
        restoreDraft(editor);
        if (!state.mobile) editor.focus();
      }),
    [persistDraftFor, restoreDraft, saveDraftDebounced, storeApi],
  );

  return { restoreDraft, saveDraftDebounced };
};

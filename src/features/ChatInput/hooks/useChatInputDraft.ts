import type { IEditor } from '@lobehub/editor';
import { debounce } from 'es-toolkit/compat';
import { useCallback, useEffect, useMemo } from 'react';

import { getDraft, removeDraft, saveDraft } from '../draftStorage';
import { useStoreApi } from '../store';

const SAVE_DEBOUNCE_MS = 500;

export const useChatInputDraft = () => {
  const storeApi = useStoreApi();

  const persistDraftFor = useCallback(
    (draftKey: string) => {
      const { editor, getMarkdownContent, getJSONState } = storeApi.getState();
      if (!editor) return;

      if (getMarkdownContent().trim().length === 0) {
        removeDraft(draftKey);
        return;
      }

      const json = getJSONState();
      if (json) saveDraft(draftKey, json);
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

  useEffect(() => () => saveDraftDebounced.flush(), [saveDraftDebounced]);

  const restoreDraft = useCallback(
    (editor: IEditor) => {
      const { draftKey } = storeApi.getState();
      if (!draftKey) return;

      if (!editor.isEmpty) return;

      const draft = getDraft(draftKey);
      if (draft) editor.setDocument('json', draft);
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

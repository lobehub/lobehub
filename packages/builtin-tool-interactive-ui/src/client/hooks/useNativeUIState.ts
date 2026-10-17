import { useEffect, useRef, useState } from 'react';

import { useConversationStore, useConversationStoreApi } from '@/features/Conversation/store';
import { messageService } from '@/services/message';
import { getChatStoreState } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useUserStore } from '@/store/user';

import { createNativeUIState, updateNativeUIState } from '../../native/engine';
import type { NativeUIDocument, NativeUIState, NativeUIValue } from '../../native/types';
import { createStatePersistenceRegistry, type SaveStatus } from '../statePersistence';
import { canSubmitInteractiveUI } from '../submission';

const registry = createStatePersistenceRegistry<NativeUIState>();

/** Native state is a bounded scalar map, persisted on the existing tool result.
 * The artifact contains no write instruction: only the host's controls call this
 * hook. Restoring state never writes or proposes a message. */
export const useNativeUIState = (
  document: NativeUIDocument,
  saved: unknown,
  messageId: string,
  readOnly: boolean,
) => {
  const store = useConversationStoreApi();
  const currentUserId = useUserStore((state) => state.user?.id);
  const [originalUserId, setOriginalUserId] = useState(currentUserId);
  const [originalContext] = useState(() => ({ ...store.getState().context }));
  const originalContextKey = messageMapKey(originalContext);
  const sessionKey = JSON.stringify([originalUserId, originalContextKey, messageId]);
  const [values, setValues] = useState(
    () => registry.peek(sessionKey)?.value ?? createNativeUIState(document, saved),
  );
  const valuesRef = useRef(values);
  const hasLocalEdits = useRef(!!registry.peek(sessionKey));
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(
    () => registry.peek(sessionKey)?.status ?? 'idle',
  );

  const canWrite = () => {
    const state = store.getState();
    return (
      !!originalUserId &&
      useUserStore.getState().user?.id === originalUserId &&
      canSubmitInteractiveUI({
        busy: false,
        currentContextKey: messageMapKey(state.context),
        originalContextKey,
        readOnly: readOnlyRef.current,
        source: state.dbMessages.find((message) => message.id === messageId),
        target: state.composerTarget,
      })
    );
  };
  const writable = useConversationStore(
    (state) =>
      !!originalUserId &&
      currentUserId === originalUserId &&
      canSubmitInteractiveUI({
        busy: false,
        currentContextKey: messageMapKey(state.context),
        originalContextKey,
        readOnly,
        source: state.dbMessages.find((message) => message.id === messageId),
        target: state.composerTarget,
      }),
  );

  const persist = async (next: NativeUIState) => {
    if (!originalUserId || useUserStore.getState().user?.id !== originalUserId) {
      throw new Error('The original account is no longer active.');
    }
    // Enqueue is authorized while this source is mounted. Finish those
    // already accepted edits even after SPA navigation, always against the
    // captured source and context. The server still authorizes each write.
    const result = await messageService.updateMessagePluginState(
      messageId,
      { values: next },
      originalContext,
    );
    if (!result.success) throw new Error('Selections were not saved.');
    // Never let an old full transcript overwrite concurrent model updates.
    // This field update targets the captured bucket even after unmount.
    if (useUserStore.getState().user?.id === originalUserId) {
      getChatStoreState().internal_dispatchMessage(
        { id: messageId, key: 'values', type: 'updatePluginState', value: next },
        { context: originalContext },
      );
    }
  };

  useEffect(() => {
    if (!originalUserId && currentUserId) setOriginalUserId(currentUserId);
  }, [currentUserId, originalUserId]);

  useEffect(() => {
    const receive = (snapshot: { status: SaveStatus; value: NativeUIState }) => {
      hasLocalEdits.current = true;
      valuesRef.current = snapshot.value;
      setValues(snapshot.value);
      setSaveStatus(snapshot.status);
      if (
        snapshot.status === 'saved' &&
        useUserStore.getState().user?.id === originalUserId &&
        messageMapKey(store.getState().context) === originalContextKey
      ) {
        store.getState().internal_dispatchMessage({
          id: messageId,
          key: 'values',
          type: 'updatePluginState',
          value: snapshot.value,
        });
      }
    };
    const pending = registry.peek(sessionKey);
    if (pending) receive(pending);
    return registry.subscribe(sessionKey, receive);
  }, [messageId, originalContextKey, originalUserId, sessionKey, store]);

  useEffect(() => {
    // A cold mount can first receive cached values, then a fresh server row.
    // Adopt hydration until the user takes ownership; never replace live edits
    // with an older acknowledgement or a background cache revalidation.
    if (hasLocalEdits.current) return;
    const restored = createNativeUIState(document, saved);
    if (JSON.stringify(restored) === JSON.stringify(valuesRef.current)) return;
    valuesRef.current = restored;
    setValues(restored);
  }, [document, saved]);

  useEffect(() => {
    if (saveStatus !== 'saving' && saveStatus !== 'failed') return;
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnUnsaved);
    return () => window.removeEventListener('beforeunload', warnUnsaved);
  }, [saveStatus]);

  const update = (key: string, value: NativeUIValue) => {
    if (!canWrite()) return;
    const next = updateNativeUIState(
      document,
      registry.peek(sessionKey)?.value ?? valuesRef.current,
      key,
      value,
    );
    if (next === valuesRef.current) return;
    hasLocalEdits.current = true;
    valuesRef.current = next;
    setValues(next);
    registry.enqueue(sessionKey, next, persist);
  };

  const retrySave = () => {
    if (canWrite()) registry.retry(sessionKey);
  };
  return { retrySave, saveStatus, update, values, writable };
};

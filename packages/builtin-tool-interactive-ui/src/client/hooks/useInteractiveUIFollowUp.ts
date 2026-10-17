import { useRef, useState } from 'react';

import { useConversationStore, useConversationStoreApi } from '@/features/Conversation/store';
import { useSingleton } from '@/hooks/useSingleton';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import {
  canSubmitInteractiveUI,
  formatInteractiveUIFollowUp,
  getFollowUpDraftValidation,
} from '../submission';

/** The only send path lives in the host. The sandbox can only fill a reviewable proposal. */
export const useInteractiveUIFollowUp = (messageId: string, title: string, readOnly: boolean) => {
  const store = useConversationStoreApi();
  const [originalContextKey] = useState(() => messageMapKey(store.getState().context));
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'uncertain'>('idle');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const submitted = useSingleton(() => new Set<string>());

  const allowed = useConversationStore((state) =>
    canSubmitInteractiveUI({
      busy: state.operationState.isInputLoading,
      currentContextKey: messageMapKey(state.context),
      originalContextKey,
      readOnly,
      source: state.dbMessages.find((message) => message.id === messageId),
      target: state.composerTarget,
    }),
  );

  const submit = async (requestId: string, text: string, trusted: boolean) => {
    if (!trusted || inFlight.current || submitted.has(requestId)) return;
    if (!getFollowUpDraftValidation(text).canSend) return;
    const state = store.getState();
    if (
      !canSubmitInteractiveUI({
        busy: state.operationState.isInputLoading,
        currentContextKey: messageMapKey(state.context),
        originalContextKey,
        readOnly,
        source: state.dbMessages.find((message) => message.id === messageId),
        target: state.composerTarget,
      })
    )
      return;

    inFlight.current = true;
    setPending(true);
    submitted.add(requestId);
    setStatus('sending');
    let accepted = false;
    try {
      await state.sendMessage({
        conversationContext: { ...state.context },
        message: formatInteractiveUIFollowUp(title, messageId, text),
        onMessageAccepted: () => {
          accepted = true;
          setStatus('sent');
        },
        onPreflightFailure: () => setStatus('uncertain'),
        preserveComposer: true,
      });
      setStatus(accepted ? 'sent' : 'uncertain');
    } catch {
      // A network error can happen after persistence. Never automatically replay a send.
      setStatus(accepted ? 'sent' : 'uncertain');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const dismiss = () => {
    if (inFlight.current) return false;
    setStatus('idle');
    return true;
  };
  return { allowed, dismiss, pending, status, submit };
};

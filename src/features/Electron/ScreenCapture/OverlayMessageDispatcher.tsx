'use client';

import { SESSION_CHAT_URL } from '@lobechat/const';
import {
  type OverlayDispatchMessagePayload,
  useWatchBroadcast,
} from '@lobechat/electron-client-ipc';
import { nanoid } from '@lobechat/utils';
import { memo, useCallback } from 'react';

import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import { getOverlayDispatchStoreState } from './overlayDispatchStore';

/**
 * Receives screen-capture overlay submissions forwarded by the main process.
 * Uploads are already running (or finished) in `OverlayCaptureUploader` from
 * the preview stage; this component only routes the main window to the
 * target conversation and records captureIds for the downstream consumer.
 */
const OverlayMessageDispatcher = memo(() => {
  const router = useQueryRoute();

  const handler = useCallback(
    async (payload: OverlayDispatchMessagePayload) => {
      const inboxAgentId = builtinAgentSelectors.inboxAgentId(useAgentStore.getState());
      const agentId = payload.agentId || inboxAgentId;
      if (!agentId) return;

      const dispatchId = nanoid();

      getOverlayDispatchStoreState().setPendingDispatch({
        agentId,
        captureIds: payload.captureIds,
        dispatchId,
        modelId: payload.modelId,
        prompt: payload.prompt,
        provider: payload.provider,
      });

      const { activeAgentId, activeTopicId, switchTopic } = useChatStore.getState();
      if (activeAgentId === agentId && activeTopicId) {
        await switchTopic(null, { skipRefreshMessage: true });
      }

      // replace: true drops prev search params (e.g. a stale `message=`) so
      // MessageFromUrl's message-param effect cannot double-fire alongside
      // the overlay dispatch path.
      router.push(SESSION_CHAT_URL(agentId, false), { query: {}, replace: true });
    },
    [router],
  );

  useWatchBroadcast('overlayDispatchMessage', handler);

  return null;
});

OverlayMessageDispatcher.displayName = 'OverlayMessageDispatcher';

export default OverlayMessageDispatcher;

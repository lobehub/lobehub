'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import { useConversationStore } from '@/features/Conversation';
import { useConversationResourceAccess } from '@/features/Conversation/hooks/useConversationResourceAccess';
import { overlayCaptureUploadPool } from '@/features/Electron/ScreenCapture/overlayCaptureUploadPool';
import { canConsumePendingOverlayDispatch } from '@/features/Electron/ScreenCapture/overlayDispatch';
import { useOverlayDispatchStore } from '@/features/Electron/ScreenCapture/overlayDispatchStore';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import type { UploadFileItem } from '@/types/files/upload';

/**
 * MessageFromUrl
 *
 * Handles deferred sends that must wait for the current agent conversation to
 * finish switching and initializing before calling `sendMessage`.
 */
const MessageFromUrl = () => {
  const [sendMessage, context, messagesInit] = useConversationStore((s) => [
    s.sendMessage,
    s.context,
    s.messagesInit,
  ]);
  const agentId = context.agentId;
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const isAgentConfigLoading = useAgentStore(agentSelectors.isAgentConfigLoading);
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  // Per-resource General access: view-only members must not auto-send into a
  // shared agent, whatever the URL says. Wait for the settled value — the
  // permissive loading default would otherwise let the send race through.
  const { canUseResource, isAccessLoading } = useConversationResourceAccess();
  const [pendingDispatch, clearPendingDispatch] = useOverlayDispatchStore((s) => [
    s.pendingDispatch,
    s.clearPendingDispatch,
  ]);

  const routeAgentId = useMemo(() => {
    const match = location.pathname?.match(/^\/agent\/([^#/?]+)/);
    return match?.[1];
  }, [location.pathname]);

  // Track last processed (agentId, message) to prevent duplicate sends on re-render,
  // while still allowing sending when navigating to a different agent (or message).
  const lastProcessedSignatureRef = useRef<string | null>(null);
  const lastProcessedOverlayDispatchIdRef = useRef<string | null>(null);

  useEffect(() => {
    const message = searchParams.get('message');
    if (!message) return;
    if (!canCreate) return;

    // Wait for agentId to be available before sending
    if (!agentId) return;

    // During agent switching, URL/searchParams may update before ConversationStore context updates.
    // Only consume the param when the route agentId matches the ConversationStore agentId.
    if (routeAgentId && routeAgentId !== agentId) return;

    // Ensure required agent info is loaded before consuming the param.
    // For existing conversations (topicId exists), also wait until messages are initialized
    // to avoid sending during skeleton fetch states.
    const isNewConversation = !context.topicId;
    const isReady = !isAgentConfigLoading && (isNewConversation || messagesInit);
    if (!isReady) return;

    if (isAccessLoading) return;

    const signature = `${agentId}::${message}`;
    if (lastProcessedSignatureRef.current === signature) return;
    lastProcessedSignatureRef.current = signature;

    // Use functional update to safely remove message param without affecting other params
    setSearchParams(
      (prev) => {
        const newParams = new URLSearchParams(prev);
        newParams.delete('message');
        return newParams;
      },
      { replace: true },
    );

    // View-only: consume the param (so it doesn't linger in the URL) but
    // never send.
    if (!canUseResource) return;

    // Send the message
    sendMessage({ message });
  }, [
    searchParams,
    setSearchParams,
    sendMessage,
    agentId,
    canCreate,
    canUseResource,
    isAccessLoading,
    context.topicId,
    isAgentConfigLoading,
    messagesInit,
    routeAgentId,
  ]);

  useEffect(() => {
    if (!pendingDispatch) return;
    if (!canCreate) return;
    if (isAccessLoading) return;

    if (
      !canConsumePendingOverlayDispatch({
        agentId,
        isAgentConfigLoading,
        messagesInit,
        pendingDispatch,
        routeAgentId,
        topicId: context.topicId,
      })
    ) {
      return;
    }

    if (lastProcessedOverlayDispatchIdRef.current === pendingDispatch.dispatchId) return;
    lastProcessedOverlayDispatchIdRef.current = pendingDispatch.dispatchId;

    // View-only: drop the parked dispatch instead of sending / writing config.
    if (!canUseResource) {
      const { captureIds, dispatchId } = pendingDispatch;
      for (const captureId of captureIds) overlayCaptureUploadPool.remove(captureId);
      clearPendingDispatch(dispatchId);
      return;
    }

    const { captureIds, modelId, prompt, provider } = pendingDispatch;
    const captureEntries = captureIds
      .map((id) => ({ entry: overlayCaptureUploadPool.get(id), id }))
      .filter((x): x is { entry: NonNullable<typeof x.entry>; id: string } => !!x.entry);

    void (async () => {
      try {
        if (canEdit && modelId && provider) {
          const agentState = useAgentStore.getState();
          const currentModel = agentByIdSelectors.getAgentModelById(agentId!)(agentState);
          const currentProvider = agentByIdSelectors.getAgentModelProviderById(agentId!)(
            agentState,
          );
          if (currentModel !== modelId || currentProvider !== provider) {
            await agentState.updateAgentConfigById(agentId!, { model: modelId, provider });
          }
        }

        const resolved = await Promise.all(captureEntries.map(({ entry }) => entry.promise));
        const overlayFiles = resolved.filter((item): item is UploadFileItem => !!item);

        if (!prompt && overlayFiles.length === 0) return;

        await sendMessage({ files: overlayFiles, message: prompt });
      } finally {
        for (const { id } of captureEntries) overlayCaptureUploadPool.remove(id);
        clearPendingDispatch(pendingDispatch.dispatchId);
      }
    })();
  }, [
    agentId,
    canCreate,
    canEdit,
    canUseResource,
    clearPendingDispatch,
    context.topicId,
    isAccessLoading,
    isAgentConfigLoading,
    messagesInit,
    pendingDispatch,
    routeAgentId,
    sendMessage,
  ]);

  return null;
};

export default MessageFromUrl;

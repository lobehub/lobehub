import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { HeterogeneousAgentSessionError } from '@lobechat/electron-client-ipc';

/**
 * Subscribe to Electron IPC broadcasts. As of phase 0, the main
 * process runs JSONL framing + adapter conversion + `toStreamEvent` itself
 * (`AgentStreamPipeline` from `@lobechat/heterogeneous-agents/spawn`), so the
 * renderer receives ready-made `AgentStreamEvent`s with no per-event adapter
 * step. Returns unsubscribe function.
 */
export const subscribeBroadcasts = (
  sessionId: string,
  callbacks: {
    onComplete: () => void;
    onError: (error: HeterogeneousAgentSessionError | string) => void;
    onStreamEvent: (event: AgentStreamEvent) => void;
  },
): (() => void) => {
  if (!window.electron?.ipcRenderer) return () => {};

  const ipc = window.electron.ipcRenderer;

  const onStreamEvent = (_e: any, data: { event: AgentStreamEvent; sessionId: string }) => {
    if (data.sessionId === sessionId) callbacks.onStreamEvent(data.event);
  };
  const onComplete = (_e: any, data: { sessionId: string }) => {
    if (data.sessionId === sessionId) callbacks.onComplete();
  };
  const onError = (
    _e: any,
    data: { error: HeterogeneousAgentSessionError | string; sessionId: string },
  ) => {
    if (data.sessionId === sessionId) callbacks.onError(data.error);
  };

  const unsubscribeStreamEvent = ipc.on('heteroAgentEvent' as any, onStreamEvent);
  const unsubscribeComplete = ipc.on('heteroAgentSessionComplete' as any, onComplete);
  const unsubscribeError = ipc.on('heteroAgentSessionError' as any, onError);

  return () => {
    unsubscribeStreamEvent();
    unsubscribeComplete();
    unsubscribeError();
  };
};

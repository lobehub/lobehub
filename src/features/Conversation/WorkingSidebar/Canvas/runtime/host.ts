import manifestUrl from 'virtual:canvas-runtime';

import { CanvasRuntimeManager } from './CanvasRuntimeManager';
import { createCanvasRuntimeSource } from './CanvasRuntimeSource';

const manager = new CanvasRuntimeManager((signal) =>
  createCanvasRuntimeSource(
    new URL(manifestUrl, window.location.href),
    signal,
    import.meta.env.VITE_VERCEL_DEPLOYMENT_ID,
  ),
);

const frames = new WeakMap<HTMLIFrameElement, { detach: () => void; resume: () => void }>();

export const attachCanvasRuntime = (
  frame: HTMLIFrameElement,
  onError: (error: unknown) => void,
) => {
  const existing = frames.get(frame);
  if (existing) {
    existing.resume();
    return existing.detach;
  }
  const lease = manager.acquire();
  let active = true;
  let instanceId: string | undefined;
  const host = frame.ownerDocument.defaultView!;
  const post = (message: Record<string, unknown>) =>
    frame.contentWindow?.postMessage({ ...message, source: 'lobe-canvas-host' }, '*');
  const onMessage = (event: MessageEvent) => {
    if (
      event.source !== frame.contentWindow ||
      event.data?.source !== 'lobe-canvas' ||
      typeof event.data.instanceId !== 'string'
    )
      return;
    if (event.data.type === 'load-addon' && event.data.instanceId === instanceId) {
      const { name, requestId } = event.data;
      if ((name !== 'highlight' && name !== 'mermaid') || typeof requestId !== 'number') return;
      const nextId = instanceId;
      void lease
        .loadAddon(name)
        .then((bundle) => {
          if (active && instanceId === nextId)
            post({ type: 'addon', bundle, name, requestId, instanceId });
        })
        .catch((error) => {
          if (active && instanceId === nextId)
            post({ type: 'addon', error: String(error), requestId, instanceId });
        });
      return;
    }
    if (event.data.type !== 'ready') return;
    const nextId = event.data.instanceId;
    if (nextId === instanceId) return;
    instanceId = nextId;
    void lease.ready
      .then((bundle) => {
        if (active && instanceId === nextId) post({ type: 'runtime', bundle, instanceId });
      })
      .catch((error) => {
        if (active) onError(error);
      });
  };
  // Observe load failures even if the frame never completes its handshake.
  void lease.ready.catch((error) => {
    if (active && !instanceId) onError(error);
  });
  const request = () => post({ type: 'request-runtime' });
  host.addEventListener('message', onMessage);
  frame.addEventListener('load', request);
  request();
  let observer: MutationObserver | undefined;
  const dispose = () => {
    if (!active) return;
    active = false;
    post({ type: 'dispose-runtime', instanceId });
    host.removeEventListener('message', onMessage);
    frame.removeEventListener('load', request);
    observer?.disconnect();
    frames.delete(frame);
    lease.release();
  };
  const detach = () => {
    // Activity cleans up effects while retaining the iframe; its document is still alive.
    if (!frame.isConnected) return dispose();
    observer ??= new MutationObserver(() => {
      if (!frame.isConnected) dispose();
    });
    observer.observe(frame.ownerDocument, { childList: true, subtree: true });
  };
  frames.set(frame, { detach, resume: () => observer?.disconnect() });
  return detach;
};

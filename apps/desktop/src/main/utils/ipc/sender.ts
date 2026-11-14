import type { IpcMainInvokeEvent } from 'electron';

import { RENDERER_PROTOCOL_HOST, RENDERER_PROTOCOL_SCHEME } from '@/const/protocol';

/**
 * Whether an `invoke` came from a document the desktop APIs are meant for: the
 * top-level frame of a window showing the app's own renderer.
 *
 * The preload only runs in main frames, so a subframe or a page the window was
 * navigated to has no business reaching a controller. Checked in `IpcHandler`,
 * so every `@IpcMethod` handler inherits it.
 */
export const isTrustedIpcSender = (event: IpcMainInvokeEvent): boolean => {
  const frame = event.senderFrame;
  // Null once the frame navigated away or was destroyed mid-call.
  if (!frame || frame.parent) return false;

  try {
    const url = new URL(frame.url);
    // `URL.origin` is "null" for custom schemes in Node, so compare the parts.
    return url.protocol === `${RENDERER_PROTOCOL_SCHEME}:` && url.host === RENDERER_PROTOCOL_HOST;
  } catch {
    return false;
  }
};

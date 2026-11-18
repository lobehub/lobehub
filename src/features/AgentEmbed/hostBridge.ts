import {
  type EmbedToHostMessage,
  readHostMessage,
  wrapEmbedMessage,
} from '@lobechat/embed/protocol';

import { initEmbedTheme, setEmbedTheme } from '@/libs/agentEmbed/forcedTheme';

/**
 * The iframe side of the embed protocol (`@lobechat/embed/protocol`).
 *
 * The host's origin is learned from its `init` message and every message back
 * is posted to that origin only. Only the direct parent window is listened to:
 * a sibling frame or a popup cannot steer the conversation's theme.
 */
export interface EmbedHostBridge {
  /** Notify the host website; dropped until the host has said `init`. */
  emit: (message: EmbedToHostMessage) => void;
  /** Whether this page runs inside a host website's frame. */
  framed: boolean;
  stop: () => void;
}

export const startEmbedHostBridge = (win: Window = window): EmbedHostBridge => {
  initEmbedTheme(win.location.search);

  const framed = win.parent !== win;
  let hostOrigin: string | undefined;

  const post = (message: EmbedToHostMessage) => {
    if (!hostOrigin) return;
    win.parent.postMessage(wrapEmbedMessage(message), hostOrigin);
  };

  const onMessage = (event: MessageEvent) => {
    if (!framed || event.source !== win.parent) return;

    const message = readHostMessage(event.data);
    if (!message) return;

    if (message.type === 'init') {
      // The first `init` fixes the host; a navigation of the parent reloads us anyway.
      hostOrigin ??= event.origin;
      if (event.origin !== hostOrigin) return;
      if (message.theme) setEmbedTheme(message.theme);
      post({ type: 'ready' });
      return;
    }

    if (event.origin !== hostOrigin) return;
    setEmbedTheme(message.theme);
  };

  win.addEventListener('message', onMessage);

  return {
    emit: post,
    framed,
    stop: () => win.removeEventListener('message', onMessage),
  };
};

let sharedBridge: EmbedHostBridge | undefined;

/**
 * The page's one bridge. Started on first use and kept for the page's
 * lifetime, so a remount (or StrictMode's double render) neither drops the
 * learned host origin nor stacks a second listener.
 */
export const getEmbedHostBridge = () => (sharedBridge ??= startEmbedHostBridge());

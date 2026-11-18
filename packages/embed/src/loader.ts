import {
  buildEmbedPath,
  type EmbedTheme,
  type EmbedToHostMessage,
  type HostToEmbedMessage,
  readEmbedMessage,
  wrapEmbedMessage,
} from './protocol';

export interface LobeHubEmbedOptions {
  /** Share slug (`my-bot` in `/a/my-bot`) or share id of the Agent to embed. */
  agent: string;
  /** Accessible name and tooltip of the launcher button. */
  buttonLabel?: string;
  /** LobeHub origin serving the share, e.g. `https://app.lobehub.com`. */
  host: string;
  /** UI language of the conversation, e.g. `en-US`. Defaults to the visitor's. */
  locale?: string;
  /** Open the panel right away instead of waiting for a click on the launcher. */
  open?: boolean;
  /** Which bottom corner the launcher sits in. */
  position?: 'left' | 'right';
  theme?: EmbedTheme;
  zIndex?: number;
}

/** Events a host page can subscribe to with `embed.on(...)`. */
export type LobeHubEmbedEvent = EmbedToHostMessage['type'] | 'open';

export type LobeHubEmbedEventPayload<E extends LobeHubEmbedEvent> = E extends 'open'
  ? { type: 'open' }
  : Extract<EmbedToHostMessage, { type: E }>;

export interface LobeHubEmbed {
  close: () => void;
  /** Remove the launcher, the panel and every listener. */
  destroy: () => void;
  readonly isOpen: boolean;
  on: <E extends LobeHubEmbedEvent>(
    event: E,
    handler: (payload: LobeHubEmbedEventPayload<E>) => void,
  ) => () => void;
  open: () => void;
  setTheme: (theme: EmbedTheme) => void;
  toggle: () => void;
}

const HANDSHAKE_INTERVAL_MS = 500;
/** 2 minutes: covers a cold route chunk on a slow connection. */
const HANDSHAKE_MAX_ATTEMPTS = 240;

const CHAT_ICON =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
const CLOSE_ICON =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

const STYLE = `
:host { all: initial; }
.launcher {
  position: fixed; bottom: 20px; width: 56px; height: 56px; border: none; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  background: #000; color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.24);
  transition: transform .15s ease;
}
.launcher:hover { transform: scale(1.06); }
.launcher:focus-visible { outline: 2px solid #1677ff; outline-offset: 2px; }
.panel {
  position: fixed; bottom: 88px; width: 400px; height: min(640px, calc(100vh - 120px));
  border-radius: 16px; overflow: hidden; background: #fff;
  box-shadow: 0 12px 48px rgba(0,0,0,.24); display: none;
}
.panel[data-open="true"] { display: block; }
.panel iframe { width: 100%; height: 100%; border: 0; display: block; }
.left { left: 20px; } .right { right: 20px; }
@media (max-width: 480px) {
  .panel { inset: 0; width: 100%; height: 100%; border-radius: 0; }
  .panel[data-open="true"] + .launcher { display: none; }
}
`;

/**
 * Mount a launcher button that opens a shared Agent's conversation in a panel.
 *
 * The iframe is created on first open and kept afterwards, so closing the panel
 * never discards a conversation in progress.
 */
export const createLobeHubEmbed = (options: LobeHubEmbedOptions): LobeHubEmbed => {
  const hostOrigin = new URL(options.host).origin;
  const side = options.position === 'left' ? 'left' : 'right';
  const label = options.buttonLabel ?? 'Chat';
  let theme: EmbedTheme = options.theme ?? 'auto';
  let isOpen = false;
  let iframe: HTMLIFrameElement | undefined;

  const handlers = new Map<LobeHubEmbedEvent, Set<(payload: any) => void>>();
  const emit = (payload: { type: LobeHubEmbedEvent }) => {
    for (const handler of handlers.get(payload.type) ?? []) handler(payload);
  };

  const root = document.createElement('div');
  root.dataset.lobehubEmbed = '';
  root.style.position = 'fixed';
  root.style.zIndex = String(options.zIndex ?? 2_147_483_000);
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${STYLE}</style>`;

  const panel = document.createElement('div');
  panel.className = `panel ${side}`;
  panel.dataset.open = 'false';

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = `launcher ${side}`;
  launcher.title = label;
  launcher.setAttribute('aria-label', label);
  launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = CHAT_ICON;

  shadow.append(panel, launcher);
  document.body.append(root);

  const post = (message: HostToEmbedMessage) => {
    iframe?.contentWindow?.postMessage(wrapEmbedMessage(message), hostOrigin);
  };

  const ensureIframe = () => {
    if (iframe) return;

    const src = new URL(buildEmbedPath(options.agent), hostOrigin);
    src.searchParams.set('theme', theme);
    if (options.locale) src.searchParams.set('hl', options.locale);

    iframe = document.createElement('iframe');
    iframe.src = src.toString();
    iframe.title = label;
    iframe.allow = 'clipboard-write';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.addEventListener('load', startHandshake);
    panel.append(iframe);
  };

  /**
   * The conversation mounts its listener only after its route chunk loads,
   * which can be well after the iframe's `load` event, so `init` is repeated
   * until the iframe answers `ready`.
   */
  let isReady = false;
  let handshakeTimer: ReturnType<typeof setInterval> | undefined;
  const stopHandshake = () => {
    clearInterval(handshakeTimer);
    handshakeTimer = undefined;
  };
  function startHandshake() {
    stopHandshake();
    isReady = false;
    let attempts = 0;
    post({ theme, type: 'init' });
    handshakeTimer = setInterval(() => {
      attempts += 1;
      if (attempts >= HANDSHAKE_MAX_ATTEMPTS) stopHandshake();
      else post({ theme, type: 'init' });
    }, HANDSHAKE_INTERVAL_MS);
  }

  const onMessage = (event: MessageEvent) => {
    if (!iframe || event.source !== iframe.contentWindow || event.origin !== hostOrigin) return;

    const message = readEmbedMessage(event.data);
    if (!message) return;

    if (message.type === 'ready') {
      stopHandshake();
      if (isReady) return;
      isReady = true;
    }
    // Closing from inside goes through `setOpen`, which emits the one `close` event.
    if (message.type === 'close') {
      close();
      return;
    }
    emit(message);
  };
  window.addEventListener('message', onMessage);

  const setOpen = (next: boolean) => {
    if (next === isOpen) return;
    isOpen = next;
    if (next) ensureIframe();
    panel.dataset.open = String(next);
    launcher.setAttribute('aria-expanded', String(next));
    launcher.innerHTML = next ? CLOSE_ICON : CHAT_ICON;
    emit({ type: next ? 'open' : 'close' });
  };

  const open = () => setOpen(true);
  const close = () => setOpen(false);
  const toggle = () => setOpen(!isOpen);

  launcher.addEventListener('click', toggle);

  if (options.open) open();

  return {
    close,
    destroy: () => {
      stopHandshake();
      window.removeEventListener('message', onMessage);
      handlers.clear();
      root.remove();
      iframe = undefined;
    },
    get isOpen() {
      return isOpen;
    },
    on: (event, handler) => {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
      return () => set.delete(handler);
    },
    open,
    setTheme: (next) => {
      theme = next;
      post({ theme: next, type: 'setTheme' });
    },
    toggle,
  };
};

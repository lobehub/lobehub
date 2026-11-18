import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLobeHubEmbed } from './loader';
import { EMBED_MESSAGE_SOURCE, wrapEmbedMessage } from './protocol';

const HOST = 'https://app.lobehub.com';

const getShadow = () => document.querySelector<HTMLElement>('[data-lobehub-embed]')!.shadowRoot!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createLobeHubEmbed', () => {
  it('mounts only the launcher until the visitor opens the panel', () => {
    createLobeHubEmbed({ agent: 'my-bot', host: HOST });

    const shadow = getShadow();
    expect(shadow.querySelector('button')).not.toBeNull();
    expect(shadow.querySelector('iframe')).toBeNull();
  });

  it('opens the share embed route with the theme and locale, and keeps the iframe on close', () => {
    const embed = createLobeHubEmbed({
      agent: 'my-bot',
      host: `${HOST}/x`,
      locale: 'zh-CN',
      theme: 'dark',
    });
    const onOpen = vi.fn();
    const onClose = vi.fn();
    embed.on('open', onOpen);
    embed.on('close', onClose);

    getShadow().querySelector('button')!.click();
    const iframe = getShadow().querySelector('iframe')!;
    expect(iframe.src).toBe(`${HOST}/embed/agent/my-bot?theme=dark&hl=zh-CN`);
    expect(embed.isOpen).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);

    embed.close();
    expect(embed.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getShadow().querySelector('iframe')).toBe(iframe);
  });

  it('keeps a host-side close control so the fullscreen panel always has an escape', () => {
    const embed = createLobeHubEmbed({ agent: 'my-bot', host: HOST });
    const closeButton = getShadow().querySelector<HTMLButtonElement>('[data-lobehub-embed-close]')!;

    expect(closeButton.hidden).toBe(true);

    embed.open();
    // Below 480px the panel covers the viewport and hides the launcher, so this
    // button stays outside the iframe: a blocked or failed frame cannot trap the visitor.
    expect(closeButton.hidden).toBe(false);

    closeButton.click();
    expect(embed.isOpen).toBe(false);
    expect(closeButton.hidden).toBe(true);
  });

  it('repeats init to the LobeHub origin until the conversation answers ready', () => {
    vi.useFakeTimers();
    try {
      const embed = createLobeHubEmbed({ agent: 'my-bot', host: HOST, open: true });
      const iframe = getShadow().querySelector('iframe')!;
      const source = { postMessage: vi.fn() };
      Object.defineProperty(iframe, 'contentWindow', { value: source });
      const onReady = vi.fn();
      embed.on('ready', onReady);

      iframe.dispatchEvent(new Event('load'));
      vi.advanceTimersByTime(1000);
      const init = wrapEmbedMessage({ theme: 'auto', type: 'init' });
      expect(source.postMessage).toHaveBeenCalledTimes(3);
      expect(source.postMessage).toHaveBeenCalledWith(init, HOST);

      const ready = wrapEmbedMessage({ type: 'ready' });
      window.dispatchEvent(
        new MessageEvent('message', { data: ready, origin: HOST, source: source as any }),
      );
      window.dispatchEvent(
        new MessageEvent('message', { data: ready, origin: HOST, source: source as any }),
      );
      vi.advanceTimersByTime(2000);
      expect(source.postMessage).toHaveBeenCalledTimes(3);
      expect(onReady).toHaveBeenCalledTimes(1);

      embed.setTheme('light');
      expect(source.postMessage).toHaveBeenLastCalledWith(
        wrapEmbedMessage({ theme: 'light', type: 'setTheme' }),
        HOST,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts events only from its own iframe on the LobeHub origin', () => {
    const embed = createLobeHubEmbed({ agent: 'my-bot', host: HOST, open: true });
    const iframe = getShadow().querySelector('iframe')!;
    const source = { postMessage: vi.fn() };
    Object.defineProperty(iframe, 'contentWindow', { value: source });
    const onSent = vi.fn();
    embed.on('messageSent', onSent);

    const data = wrapEmbedMessage({ topicId: 'tpc_1', type: 'messageSent' });
    window.dispatchEvent(
      new MessageEvent('message', { data, origin: 'https://evil.com', source: source as any }),
    );
    window.dispatchEvent(new MessageEvent('message', { data, origin: HOST, source: window }));
    expect(onSent).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', { data, origin: HOST, source: source as any }),
    );
    expect(onSent).toHaveBeenCalledWith({ topicId: 'tpc_1', type: 'messageSent' });

    const onClose = vi.fn();
    embed.on('close', onClose);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: EMBED_MESSAGE_SOURCE, type: 'close', version: 1 },
        origin: HOST,
        source: source as any,
      }),
    );
    expect(embed.isOpen).toBe(false);
    // One close per closing, whether the host or the panel asked for it.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('removes itself on destroy', () => {
    const embed = createLobeHubEmbed({ agent: 'my-bot', host: HOST });
    embed.destroy();
    expect(document.querySelector('[data-lobehub-embed]')).toBeNull();
  });
});

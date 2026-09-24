import { captureViewport, HOST_ATTRIBUTE, installErrorCapture, recentErrors } from './capture';
import { type PageSource, type Remark, ReviewClient, ReviewError } from './client';
import { type Messages, messagesFor } from './i18n';
import { elementTextOf, selectorFor } from './selector';
import { STYLES } from './styles';

export interface ReviewToolbarOptions {
  acceptanceId: string;
  /** Build / commit the page was served from; defaults to `<meta name="lobehub-review:commit">`. */
  commit?: string;
  /**
   * Product-defined facts attached to every remark, read at the moment it is
   * written — e.g. `() => ({ scenario: 'training-mixed', seed: 7 })`.
   */
  context?: () => Record<string, boolean | number | string> | undefined;
  /** Show the floating "Review" button (default true). Without it, call `toggle()` yourself. */
  launcher?: boolean;
  locale?: string;
  /** LobeHub origin, e.g. https://app.lobehub.com */
  server: string;
}

type Box = { height: number; left: number; top: number; width: number };
const boxOf = (element: Element): Box => {
  const { height, left, top, width } = element.getBoundingClientRect();
  return { height, left, top, width };
};
const place = (el: HTMLElement, box: Box) =>
  Object.assign(el.style, {
    height: `${box.height}px`,
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
  });

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string | false | null | undefined)[]
) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const child of children) if (child) el.append(child);
  return el;
}

const COMPOSER_WIDTH = 340;
const COMPOSER_HEIGHT = 190;
const pagePath = (url: string) => {
  try {
    const { pathname, search } = new URL(url);
    return pathname + search;
  } catch {
    return url;
  }
};

/**
 * The review toolbar mounted into a product page. Picking intercepts the
 * page's own pointer events (links and buttons do not fire while reviewing);
 * everything the toolbar draws lives in one shadow root.
 */
export class ReviewToolbar {
  private readonly client: ReviewClient;
  private readonly t: Messages;
  private readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private readonly root: HTMLElement;
  private readonly highlight: HTMLElement;
  private picking = false;
  private panelOpen = false;
  private connectOpen = false;
  /** Set while waiting for the reviewer in the approval popup; aborting stops waiting. */
  private connecting: AbortController | null = null;
  private target: { box: Box; element: Element } | null = null;
  private draft = '';
  private overall = '';
  private saving = false;
  private sending = false;
  private remarks: Remark[] = [];
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: ReviewToolbarOptions) {
    installErrorCapture();
    this.client = new ReviewClient({ acceptanceId: options.acceptanceId, server: options.server });
    this.t = messagesFor(options.locale);
    this.host = h('div');
    this.host.setAttribute(HOST_ATTRIBUTE, '');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.append(h('style', { textContent: STYLES }));
    this.root = h('div', { className: 'root' });
    this.highlight = h('div', { className: 'highlight' });
    this.shadow.append(this.root);
    document.body.append(this.host);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('scroll', this.relayout, true);
    window.addEventListener('resize', this.relayout);
    if (this.client.current()) void this.refresh();
    this.render();
  }

  destroy() {
    this.connecting?.abort();
    this.stopPicking();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('scroll', this.relayout, true);
    window.removeEventListener('resize', this.relayout);
    this.host.remove();
  }

  /** Enter or leave review mode; asks for authorization first when there is no session. */
  toggle = () => {
    if (this.picking) return this.stopPicking();
    if (!this.client.current()) {
      this.connectOpen = !this.connectOpen;
      return this.render();
    }
    this.startPicking();
  };

  // ---------- session ----------

  private connect = async () => {
    this.connecting?.abort();
    const controller = new AbortController();
    this.connecting = controller;
    this.render();
    try {
      await this.client.connect({ signal: controller.signal });
      this.connectOpen = false;
      await this.refresh();
      this.startPicking();
    } catch (error) {
      const code = error instanceof ReviewError ? error.code : '';
      if (code !== 'CANCELLED')
        this.toast(code === 'POPUP_BLOCKED' ? this.t.popupBlocked : this.t.connectFailed);
    } finally {
      if (this.connecting === controller) this.connecting = null;
      this.render();
    }
  };

  private async refresh() {
    try {
      this.remarks = await this.client.listMine();
    } catch (error) {
      this.handleError(error);
    }
    this.render();
  }

  private handleError(error: unknown) {
    if (error instanceof ReviewError && error.status === 401) {
      this.stopPicking();
      this.panelOpen = false;
      this.toast(this.t.sessionEnded);
    } else this.toast(error instanceof Error ? error.message : String(error));
  }

  // ---------- picking ----------

  private isOwn = (event: Event) => event.composedPath().includes(this.host);

  private startPicking() {
    if (this.picking) return;
    this.picking = true;
    document.addEventListener('mousemove', this.onMove, true);
    document.addEventListener('pointerdown', this.swallow, true);
    document.addEventListener('mousedown', this.swallow, true);
    document.addEventListener('click', this.onClick, true);
    this.render();
  }

  private stopPicking() {
    this.picking = false;
    this.target = null;
    this.draft = '';
    document.removeEventListener('mousemove', this.onMove, true);
    document.removeEventListener('pointerdown', this.swallow, true);
    document.removeEventListener('mousedown', this.swallow, true);
    document.removeEventListener('click', this.onClick, true);
    this.render();
  }

  private onMove = (event: MouseEvent) => {
    if (this.target || this.panelOpen || this.isOwn(event) || !(event.target instanceof Element)) {
      this.highlight.remove();
      return;
    }
    place(this.highlight, boxOf(event.target));
    if (!this.highlight.isConnected) this.root.append(this.highlight);
  };

  private swallow = (event: Event) => {
    if (this.panelOpen || this.isOwn(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  private onClick = (event: MouseEvent) => {
    if (this.panelOpen || this.isOwn(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!(event.target instanceof Element)) return;
    this.target = { box: boxOf(event.target), element: event.target };
    this.draft = '';
    this.render();
    (this.shadow.querySelector('.composer textarea') as HTMLTextAreaElement | null)?.focus();
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === 'e' && event.shiftKey && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.toggle();
      return;
    }
    if (event.key !== 'Escape') return;
    if (this.target) {
      this.target = null;
      this.render();
    } else if (this.panelOpen) {
      this.panelOpen = false;
      this.render();
    } else if (this.picking) this.stopPicking();
  };

  private relayout = () => {
    if (!this.picking) return;
    if (this.target) this.target = { ...this.target, box: boxOf(this.target.element) };
    this.render();
  };

  // ---------- actions ----------

  private sourceOf(element: Element, box: Box): PageSource {
    const commit =
      this.options.commit ??
      document.querySelector<HTMLMetaElement>('meta[name="lobehub-review:commit"]')?.content;
    let extra: Record<string, boolean | number | string> | undefined;
    try {
      extra = this.options.context?.();
    } catch (error) {
      console.warn('[lobehub-review] context() failed', error);
    }
    return {
      commit: commit || undefined,
      consoleErrors: recentErrors(),
      elementText: elementTextOf(element.textContent) || undefined,
      extra: extra && Object.keys(extra).length ? extra : undefined,
      kind: 'product-page',
      rect: { height: box.height, width: box.width, x: box.left, y: box.top },
      selector: selectorFor(element),
      title: document.title.slice(0, 300) || undefined,
      url: window.location.href,
      userAgent: navigator.userAgent,
      viewport: { height: window.innerHeight, width: window.innerWidth },
    };
  }

  private save = async () => {
    if (!this.target || !this.draft.trim() || this.saving) return;
    this.saving = true;
    this.render();
    try {
      const { element, box } = this.target;
      const screenshot = await captureViewport(element);
      await this.client.create({
        content: this.draft.trim(),
        screenshot,
        source: this.sourceOf(element, box),
      });
      this.target = null;
      this.draft = '';
      this.toast(screenshot ? this.t.saved : this.t.savedNoShot);
      await this.refresh();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.saving = false;
      this.render();
    }
  };

  private remove = async (id: string) => {
    try {
      await this.client.remove(id);
      await this.refresh();
    } catch (error) {
      this.handleError(error);
    }
  };

  private sendBack = async () => {
    if (this.sending) return;
    this.sending = true;
    this.render();
    try {
      const { repairDispatch } = await this.client.reject(this.overall.trim());
      this.overall = '';
      this.panelOpen = false;
      this.stopPicking();
      this.toast(repairDispatch.dispatched ? this.t.rejectedDispatched : this.t.rejectedNoAgent);
      await this.refresh();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.sending = false;
      this.render();
    }
  };

  private toast(message: string) {
    clearTimeout(this.toastTimer);
    this.shadow.querySelector('.toast')?.remove();
    const el = h('div', { className: 'toast', role: 'status', textContent: message });
    this.root.append(el);
    this.toastTimer = setTimeout(() => el.remove(), 3200);
  }

  // ---------- render ----------

  private render() {
    // Rebuilding the tree would drop focus and caret from a textarea the
    // reviewer is typing in (a scroll or resize re-renders); carry them over.
    const focused = this.shadow.activeElement as HTMLTextAreaElement | null;
    const focusKey = focused?.dataset?.key;
    const caret = focusKey ? [focused!.selectionStart, focused!.selectionEnd] : null;
    this.paint();
    if (focusKey && caret) {
      const next = this.shadow.querySelector<HTMLTextAreaElement>(
        `textarea[data-key="${focusKey}"]`,
      );
      next?.focus();
      next?.setSelectionRange(caret[0], caret[1]);
    }
  }

  private paint() {
    const t = this.t;
    const session = this.client.current();
    const count = this.remarks.length;
    const toast = this.shadow.querySelector('.toast');
    this.root.replaceChildren();
    if (toast) this.root.append(toast);

    if (!this.picking && this.options.launcher !== false)
      this.root.append(
        h(
          'button',
          { className: 'launcher', onclick: this.toggle, title: `${t.start} (⌘⇧E)` },
          h('span', { className: 'dot' }),
          `${t.start}${count ? ` · ${count}` : ''}`,
        ),
      );

    if (this.connectOpen && !session)
      this.root.append(
        h(
          'div',
          { className: 'connect', role: 'dialog' },
          h('strong', { textContent: t.connectTitle }),
          h('span', {
            className: 'muted',
            textContent: this.connecting ? t.connectWaiting : t.connectHint,
          }),
          h(
            'div',
            { className: 'row end' },
            h('button', {
              onclick: () => {
                this.connecting?.abort();
                this.connectOpen = false;
                this.render();
              },
              textContent: t.cancel,
            }),
            h('button', {
              className: 'primary',
              disabled: Boolean(this.connecting),
              onclick: this.connect,
              textContent: this.connecting ? '…' : t.allow,
            }),
          ),
        ),
      );

    if (!this.picking) return;

    const here = pagePath(window.location.href);
    this.remarks.forEach((remark, index) => {
      if (!remark.source?.selector || pagePath(remark.source.url) !== here) return;
      let element: Element | null = null;
      try {
        element = document.querySelector(remark.source.selector);
      } catch {
        // The page changed under the selector: no pin.
      }
      if (!element) return;
      const box = boxOf(element);
      const pin = h('div', { className: 'pin', textContent: String(count - index) });
      Object.assign(pin.style, { left: `${box.left}px`, top: `${box.top}px` });
      this.root.append(pin);
    });

    if (this.target) {
      const frame = h('div', { className: 'highlight' });
      place(frame, this.target.box);
      const selector = selectorFor(this.target.element);
      const below = this.target.box.top + this.target.box.height + 8;
      const top =
        below + COMPOSER_HEIGHT < window.innerHeight
          ? below
          : Math.max(8, this.target.box.top - COMPOSER_HEIGHT - 8);
      const left = Math.min(
        Math.max(8, this.target.box.left),
        window.innerWidth - COMPOSER_WIDTH - 8,
      );
      const textarea = h('textarea', { placeholder: t.composerPlaceholder, value: this.draft });
      textarea.dataset.key = 'composer';
      textarea.addEventListener('input', () => {
        this.draft = textarea.value;
        saveButton.disabled = !this.draft.trim() || this.saving;
      });
      textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void this.save();
      });
      const saveButton = h('button', {
        className: 'primary',
        disabled: !this.draft.trim() || this.saving,
        onclick: this.save,
        textContent: this.saving ? '…' : `${t.save} ⌘↵`,
      });
      const composer = h(
        'div',
        { className: 'composer', role: 'dialog' },
        h('div', { className: 'mono', textContent: selector, title: selector }),
        textarea,
        h(
          'div',
          { className: 'row end' },
          h('button', {
            onclick: () => ((this.target = null), this.render()),
            textContent: t.cancel,
          }),
          saveButton,
        ),
      );
      Object.assign(composer.style, { left: `${left}px`, top: `${top}px` });
      this.root.append(frame, composer);
    }

    this.root.append(
      h(
        'div',
        { className: 'toolbar', role: 'toolbar' },
        h('span', { className: 'dot' }),
        h('span', { className: 'hint', textContent: t.hint }),
        h('button', {
          onclick: () => ((this.panelOpen = true), this.render()),
          textContent: t.drafts(count),
        }),
        h('button', {
          className: 'primary',
          disabled: !count,
          onclick: () => ((this.panelOpen = true), this.render()),
          textContent: t.sendBack(count),
        }),
        h('button', { className: 'text', onclick: () => this.stopPicking(), textContent: t.exit }),
      ),
    );

    if (this.panelOpen && session)
      this.root.append(
        this.renderPanel(
          session.acceptance.title,
          session.expiresAt,
          session.capabilities.includes('reject'),
        ),
      );
  }

  private renderPanel(title: string, expiresAt: string, canReject: boolean) {
    const t = this.t;
    const count = this.remarks.length;
    const list = h('div', { className: 'list' });
    if (!count) list.append(h('div', { className: 'notice', textContent: t.empty }));
    this.remarks.forEach((remark, index) => {
      const shot = remark.attachments[0]?.url;
      list.append(
        h(
          'div',
          { className: 'item' },
          h(
            'div',
            { className: 'row between' },
            h('span', {
              className: 'mono',
              textContent: `${count - index}. ${remark.source ? pagePath(remark.source.url) : ''}`,
            }),
            h('button', {
              className: 'text',
              onclick: () => void this.remove(remark.id),
              textContent: t.delete,
            }),
          ),
          shot && h('img', { alt: '', loading: 'lazy', src: shot }),
          h('p', { textContent: remark.content }),
          remark.source?.selector &&
            h('span', { className: 'mono', textContent: remark.source.selector }),
        ),
      );
    });
    const overall = h('textarea', { placeholder: t.overallPlaceholder, value: this.overall });
    overall.dataset.key = 'overall';
    overall.addEventListener('input', () => (this.overall = overall.value));
    return h(
      'div',
      { className: 'panel', role: 'dialog' },
      h(
        'header',
        {},
        h(
          'div',
          { className: 'row between' },
          h('strong', { textContent: t.panelTitle }),
          h('button', {
            className: 'text',
            onclick: () => ((this.panelOpen = false), this.render()),
            textContent: t.close,
          }),
        ),
        h('span', { className: 'muted', textContent: title }),
        h('span', {
          className: 'muted',
          textContent: t.expires(new Date(expiresAt).toLocaleTimeString()),
        }),
      ),
      list,
      h(
        'footer',
        {},
        overall,
        canReject
          ? h('button', {
              className: 'primary',
              disabled: !count || this.sending,
              onclick: this.sendBack,
              textContent: this.sending ? '…' : t.reject(count),
            })
          : h('div', { className: 'notice', textContent: t.noReject }),
      ),
    );
  }
}

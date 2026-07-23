/**
 * In-page element picker for the browser panel's "add element to chat context"
 * action. Like the agent overlay, it must live *inside* the guest page: the page
 * is a WebContentsView that paints above all renderer DOM, so no highlight drawn
 * by the panel could ever sit on top of it.
 *
 * The script returns a Promise, which `executeJavaScript` awaits — the main
 * process simply waits until the user clicks an element (resolves with its
 * details) or cancels via Escape / `ELEMENT_PICKER_CANCEL_SCRIPT` (resolves with
 * `{ cancelled: true }`). Navigating away destroys the page's JS context and the
 * promise with it, which the controller treats as a cancel.
 */

export interface ElementPickerLabels {
  /** Bottom chip copy, e.g. "Click an element to add it · Esc to cancel". */
  hint: string;
}

/** What the picker script resolves with, as a JSON string. */
export interface PickedElementPayload {
  cancelled?: boolean;
  html?: string;
  rect?: { height: number; width: number; x: number; y: number };
  selector?: string;
  tag?: string;
  text?: string;
  /** Viewport size at pick time — lets the main process clamp the crop rect. */
  viewport?: { height: number; width: number };
}

const PICKER_HOST_ID = '__lobe-element-picker';

/** Keep the payload bounded — it becomes chat context, not an archive. */
const TEXT_MAX_CHARS = 6000;
const HTML_MAX_CHARS = 2000;

export const ELEMENT_PICKER_CANCEL_SCRIPT = `(() => {
  if (window.__lobeElementPicker) window.__lobeElementPicker.cancel();
})()`;

export const elementPickerScript = (labels: ElementPickerLabels) => `((labels) => {
  if (window.__lobeElementPicker) window.__lobeElementPicker.cancel();

  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = ${JSON.stringify(PICKER_HOST_ID)};
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML =
      '<style>' +
      '.box { position: fixed; display: none; border: 1.5px solid #2f54eb; border-radius: 2px; background: rgba(47,84,235,.12); transition: all .06s ease-out; }' +
      '.box.on { display: block }' +
      '.tag { position: absolute; inset-inline-start: -1.5px; max-width: 60vw; overflow: hidden; padding: 2px 6px; border-radius: 4px; font: 500 11px/16px system-ui, sans-serif; color: #fff; white-space: nowrap; text-overflow: ellipsis; background: #2f54eb; }' +
      '.hint { position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); padding: 4px 10px; border-radius: 16px; font: 12px system-ui, sans-serif; color: #fff; background: rgba(0,0,0,.55); backdrop-filter: blur(4px); white-space: nowrap; }' +
      '</style>' +
      '<div class="box"><div class="tag"></div></div>' +
      '<div class="hint"></div>';
    document.documentElement.append(host);

    const box = root.querySelector('.box');
    const tagLabel = root.querySelector('.tag');
    root.querySelector('.hint').textContent = labels.hint;

    const cssEscape = (value) =>
      window.CSS && CSS.escape ? CSS.escape(value) : value.replaceAll(/[^\\w-]/g, '_');

    // Short structural path — enough to point a human (or the model) at the
    // element, not a guaranteed-unique query.
    const selectorOf = (el) => {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 4) {
        if (node.id) {
          parts.unshift('#' + cssEscape(node.id));
          break;
        }
        let part = node.tagName.toLowerCase();
        const classes = [...node.classList].filter((c) => /^[a-zA-Z_][\\w-]*$/.test(c)).slice(0, 2);
        if (classes.length > 0) part += '.' + classes.join('.');
        const parent = node.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((s) => s.tagName === node.tagName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    };

    const pickableFrom = (target) => {
      if (!target || target === host || target === document.documentElement) return null;
      return target.nodeType === 1 ? target : null;
    };

    const swallow = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onMove = (event) => {
      const el = pickableFrom(event.target);
      if (!el) {
        box.classList.remove('on');
        return;
      }
      const r = el.getBoundingClientRect();
      box.classList.add('on');
      box.style.left = r.left + 'px';
      box.style.top = r.top + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
      // The label sits above the box unless that would push it off-screen.
      tagLabel.style.top = r.top < 26 ? '2px' : '-22px';
      tagLabel.textContent = selectorOf(el) || el.tagName.toLowerCase();
    };

    const listeners = [];
    const finish = (payload) => {
      for (const [name, fn] of listeners) document.removeEventListener(name, fn, true);
      host.remove();
      delete window.__lobeElementPicker;
      resolve(JSON.stringify(payload));
    };

    const onClick = (event) => {
      swallow(event);
      const el = pickableFrom(event.target);
      if (!el) return;
      const r = el.getBoundingClientRect();
      finish({
        html: el.outerHTML.slice(0, ${HTML_MAX_CHARS}),
        rect: { height: r.height, width: r.width, x: r.x, y: r.y },
        selector: selectorOf(el),
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || '').trim().slice(0, ${TEXT_MAX_CHARS}),
        viewport: { height: window.innerHeight, width: window.innerWidth },
      });
    };

    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      swallow(event);
      finish({ cancelled: true });
    };

    // Capture phase, so the page never reacts to the picking interaction — a
    // click must select the link, not follow it.
    listeners.push(
      ['mousemove', onMove],
      ['click', onClick],
      ['mousedown', swallow],
      ['mouseup', swallow],
      ['pointerdown', swallow],
      ['pointerup', swallow],
      ['keydown', onKey],
    );
    for (const [name, fn] of listeners) document.addEventListener(name, fn, true);

    window.__lobeElementPicker = { cancel: () => finish({ cancelled: true }) };
  });
})(${JSON.stringify(labels)})`;

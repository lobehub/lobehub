/**
 * The agent-control affordances (a cursor that glides to each click target, and
 * a "controlling" chip) live inside the guest so they follow page scrolling and
 * zoom while remaining isolated from the app chrome.
 *
 * Being inside the page, it must stay invisible to the agent's own tools:
 * - it hangs off `documentElement`, not `body`, so `body.innerText` (readPage)
 *   never picks up the chip text;
 * - its content lives in a shadow root, so the snapshot's `querySelectorAll`
 *   can't walk into it and mint refs for it;
 * - `screenshot` removes it before capturing, so the model never sees its own
 *   cursor in the frame.
 */

export interface AgentOverlayLabels {
  /** Chip text, e.g. "Agent is controlling". */
  controlling: string;
  /** Cursor label, e.g. "Agent". */
  cursor: string;
}

const OVERLAY_HOST_ID = '__lobe-agent-overlay';

/** Idempotent: creates the overlay if the current document doesn't have one. */
const ensureOverlay = (labels: AgentOverlayLabels) => `((labels) => {
  if (window.__lobeAgentOverlay && document.documentElement.contains(window.__lobeAgentOverlay.host)) {
    window.__lobeAgentOverlay.labels = labels;
    return;
  }

  const host = document.createElement('div');
  host.id = ${JSON.stringify(OVERLAY_HOST_ID)};
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = \`
    <style>
      .cursor {
        position: fixed;
        margin: -4px 0 0 -4px;
        transition: left .4s cubic-bezier(.3,.9,.4,1), top .4s cubic-bezier(.3,.9,.4,1);
        opacity: 0;
      }
      .cursor.on { opacity: 1 }
      .cursor svg { display: block; color: #2f54eb; filter: drop-shadow(0 1px 2px rgba(0,0,0,.3)) }
      .label {
        position: absolute; top: 18px; left: 13px;
        padding: 2px 8px; border-radius: 20px;
        font: 500 12px/18px system-ui, sans-serif; color: #fff; white-space: nowrap;
        background: #2f54eb; box-shadow: 0 1px 4px rgba(0,0,0,.15);
      }
      .ripple {
        position: absolute; top: -10px; left: -10px;
        width: 28px; height: 28px; border: 2px solid #2f54eb; border-radius: 50%;
        opacity: 0;
      }
      .ripple.go { animation: r .5s ease-out }
      @keyframes r { 0% { transform: scale(.4); opacity: 1 } 100% { transform: scale(1.2); opacity: 0 } }
      .chip {
        position: fixed; top: 8px; left: 50%; transform: translateX(-50%);
        display: none; gap: 6px; align-items: center;
        padding: 4px 10px; border-radius: 16px;
        font: 12px system-ui, sans-serif; color: #fff;
        background: rgba(0,0,0,.55); backdrop-filter: blur(4px);
      }
      .chip.on { display: flex }
      .dot { width: 6px; height: 6px; border-radius: 50%; background: #52c41a; animation: p 1.2s ease-in-out infinite }
      @keyframes p { 50% { opacity: .3 } }
    </style>
    <div class="chip"><span class="dot"></span><span class="chip-text"></span></div>
    <div class="cursor">
      <div class="ripple"></div>
      <svg fill="none" height="22" viewBox="0 0 24 24" width="22">
        <path d="M5 3l14 8-6.5 1.5L9 19 5 3z" stroke="#fff" stroke-linejoin="round" stroke-width="2.2"/>
        <path d="M5 3l14 8-6.5 1.5L9 19 5 3z" fill="currentColor" stroke="currentColor" stroke-linejoin="round" stroke-width=".8"/>
      </svg>
      <div class="label"></div>
    </div>
  \`;
  document.documentElement.append(host);

  const api = {
    host,
    labels,
    chip: root.querySelector('.chip'),
    chipText: root.querySelector('.chip-text'),
    cursor: root.querySelector('.cursor'),
    label: root.querySelector('.label'),
    ripple: root.querySelector('.ripple'),
  };
  window.__lobeAgentOverlay = api;
})(${JSON.stringify(labels)})`;

export const overlayCursorScript = (
  labels: AgentOverlayLabels,
  x: number,
  y: number,
  click: boolean,
) => `${ensureOverlay(labels)};
((x, y, click) => {
  const o = window.__lobeAgentOverlay;
  if (!o) return;
  o.label.textContent = o.labels.cursor;
  o.cursor.style.left = x + 'px';
  o.cursor.style.top = y + 'px';
  o.cursor.classList.add('on');
  if (click) {
    o.ripple.classList.remove('go');
    void o.ripple.offsetWidth;
    o.ripple.classList.add('go');
  }
})(${x}, ${y}, ${click})`;

export const overlayControllingScript = (
  labels: AgentOverlayLabels,
  active: boolean,
) => `${ensureOverlay(labels)};
((active) => {
  const o = window.__lobeAgentOverlay;
  if (!o) return;
  o.chipText.textContent = o.labels.controlling;
  o.chip.classList.toggle('on', active);
  if (!active) o.cursor.classList.remove('on');
})(${active})`;

/** Strip the overlay so the agent never captures its own cursor. */
export const OVERLAY_REMOVE_SCRIPT = `(() => {
  const host = document.getElementById(${JSON.stringify(OVERLAY_HOST_ID)});
  if (host) host.remove();
  delete window.__lobeAgentOverlay;
})()`;

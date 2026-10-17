/**
 * This is trusted bootstrap source, never generated code. Generated JavaScript
 * is imported from a separate Blob after this bootstrap runs. It must never be
 * concatenated into this script: generated declarations could hoist into it.
 */
export const WORKER_BOOTSTRAP = String.raw`
(() => {
  'use strict';
  const send = self.postMessage.bind(self);
  const now = performance.now.bind(performance);
  const stringify = String;
  const finite = Number.isFinite;
  const freeze = Object.freeze;
  const callbacks = new Map();
  let nextId = 0;
  let commands = 0;
  let windowCommands = 0;
  let windowStart = now();
  let stopped = false;
  const scalar = (value, limit) => {
    if (typeof value !== 'string' && typeof value !== 'boolean' &&
        !(typeof value === 'number' && finite(value))) return null;
    const text = stringify(value);
    return text.length <= limit ? text : null;
  };
  const selectorIsValid = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200;
  const boundedSend = (data) => {
    if (stopped) return;
    const time = now();
    if (time - windowStart >= 1000) { windowStart = time; windowCommands = 0; }
    if (++commands > 10000 || ++windowCommands > 200) {
      stopped = true;
      send({ type: 'budget' });
      return;
    }
    send(data);
  };
  setInterval(() => send({ type: 'heartbeat' }), 1000);
  self.addEventListener('message', ({ data }) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'event' && callbacks.has(data.id)) {
      callbacks.get(data.id)(freeze({ value: data.value, checked: data.checked }));
    }
  });
  // Defense in depth against runaway child workers. CSP, not these removals,
  // is the boundary for network access. No native DOM objects cross this bridge.
  for (const key of ['postMessage', 'Worker', 'SharedWorker', 'BroadcastChannel']) {
    // Web IDL methods may be inherited. Hiding only self.postMessage leaves
    // DedicatedWorkerGlobalScope.prototype.postMessage.call(self, ...) usable.
    for (let target = self; target && target !== Object.prototype; target = Object.getPrototypeOf(target)) {
      if (target === self || Object.getOwnPropertyDescriptor(target, key)) {
        Object.defineProperty(target, key, { configurable: false, value: undefined, writable: false });
      }
    }
  }
  Object.defineProperty(self, 'lobeUI', {
    configurable: false,
    writable: false,
    value: freeze({
      on(selector, event, callback) {
        if (!selectorIsValid(selector) || (event !== 'click' && event !== 'input' && event !== 'change') ||
            typeof callback !== 'function' || nextId >= 128) return;
        const id = ++nextId;
        callbacks.set(id, callback);
        boundedSend({ type: 'on', selector, event, id });
      },
      setText(selector, text) {
        const value = scalar(text, 10000);
        if (selectorIsValid(selector) && value !== null) boundedSend({ type: 'text', selector, value });
      },
      setValue(selector, input) {
        const value = scalar(input, 10000);
        if (selectorIsValid(selector) && value !== null) boundedSend({ type: 'value', selector, value });
      },
      setStyle(selector, property, value) {
        const text = scalar(value, 500);
        if (selectorIsValid(selector) && typeof property === 'string' && property.length <= 64 && text !== null) {
          boundedSend({ type: 'style', selector, property, value: text });
        }
      },
      propose(text) {
        if (typeof text === 'string' && text.length > 0 && text.length <= 2000) boundedSend({ type: 'proposal', text });
      },
    }),
  });
})();
`;

export const FRAME_BOOTSTRAP = String.raw`
(() => {
  'use strict';
  const root = document.getElementById('__lobe_ui_root');
  const status = document.getElementById('__lobe_ui_status');
  const bootstrapSource = __LOBE_WORKER_BOOTSTRAP__;
  const generatedSource = __LOBE_GENERATED_SOURCE__;
  const token = __LOBE_FRAME_TOKEN__;
  let worker;
  let workerUrl;
  let generatedUrl;
  let stopped = false;
  let commands = 0;
  let windowStart = performance.now();
  let windowCommands = 0;
  let sequence = 0;
  let bindings = 0;
  let lastHeartbeat = performance.now();
  const bindingIds = new Set();
  const cleanups = [];
  const allowedStyles = new Set([
    'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
    'color', 'background-color', 'border-color', 'border-width', 'border-radius',
    'display', 'opacity', 'transform', 'transform-origin', 'font-size', 'font-weight',
    'text-align', 'gap', 'padding', 'margin', 'flex', 'flex-direction',
    'align-items', 'justify-content', 'grid-template-columns',
  ]);
  const stop = (reason) => {
    if (stopped) return;
    stopped = true;
    if (worker) worker.terminate();
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    if (generatedUrl) URL.revokeObjectURL(generatedUrl);
    for (const cleanup of cleanups) cleanup();
    if (reason) {
      status.textContent = 'Interactive preview stopped.';
      status.hidden = false;
      parent.postMessage({ version: 1, type: 'status', token, reason,
        status: ['unsupported', 'runtime'].includes(reason) ? 'error' : 'paused' }, '*');
    }
  };
  // No unbounded execution lifetime. Remounting explicitly starts a fresh run.
  const lifetime = setTimeout(() => stop('expired'), 300000);
  cleanups.push(() => clearTimeout(lifetime));
  const watchdog = setInterval(() => {
    if (performance.now() - lastHeartbeat > 5000) stop('timeout');
  }, 1000);
  cleanups.push(() => clearInterval(watchdog));
  window.addEventListener('pagehide', () => stop(''), { once: true });
  try {
    generatedUrl = URL.createObjectURL(new Blob([generatedSource], { type: 'text/javascript' }));
    const workerSource = bootstrapSource + '\nimportScripts(' + JSON.stringify(generatedUrl) + ');';
    workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    worker = new Worker(workerUrl);
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      stop('runtime');
    });
    worker.addEventListener('messageerror', () => stop('runtime'));
    worker.addEventListener('message', ({ data }) => {
      if (stopped) return;
      const now = performance.now();
      if (now - windowStart >= 1000) { windowStart = now; windowCommands = 0; }
      if (++commands > 10000 || ++windowCommands > 200) {
        stop('budget');
        return;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      if (data.type === 'budget') { stop('budget'); return; }
      if (data.type === 'heartbeat') { lastHeartbeat = now; return; }
      if (data.type === 'proposal') {
        if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 2000 || sequence >= 20) return;
        sequence += 1;
        // The host can only display this as an untrusted proposal for review.
        parent.postMessage({ version: 1, type: 'proposal', token, requestId: 'proposal-' + sequence,
          sequence, text: data.text }, '*');
        return;
      }
      if (!['on', 'text', 'value', 'style'].includes(data.type) ||
          typeof data.selector !== 'string' || !data.selector || data.selector.length > 200) return;
      let nodes;
      try { nodes = root.querySelectorAll(data.selector); } catch { return; }
      if (nodes.length > 100) return;
      if (data.type === 'on') {
        if (!['click', 'input', 'change'].includes(data.event) ||
            !Number.isSafeInteger(data.id) || data.id <= 0 || bindingIds.has(data.id) ||
            bindings + nodes.length > 128) return;
        bindingIds.add(data.id);
        bindings += nodes.length;
        for (const node of nodes) {
          const listener = (event) => {
            if (stopped || !event.isTrusted) return;
            const target = event.currentTarget;
            // Only this widget's scalar form values are sent to its worker.
            worker.postMessage({ type: 'event', id: data.id,
              value: typeof target.value === 'string' ? target.value.slice(0, 10000) : '',
              checked: target.checked === true });
          };
          node.addEventListener(data.event, listener);
          cleanups.push(() => node.removeEventListener(data.event, listener));
        }
        return;
      }
      if (typeof data.value !== 'string' || data.value.length > 10000) return;
      for (const node of nodes) {
        if (data.type === 'text') node.textContent = data.value;
        if (data.type === 'value' && ['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)) {
          node.value = data.value;
        }
        if (data.type === 'style' && allowedStyles.has(data.property) && data.value.length <= 500 &&
            !/url\s*\(|expression\s*\(|@import/i.test(data.value)) {
          node.style.setProperty(data.property, data.value);
        }
      }
    });
  } catch {
    stop('unsupported');
  }
})();
`;

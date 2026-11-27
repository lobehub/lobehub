/**
 * A stdio MCP Apps server for testing views relayed through a device
 * (`lh connect` or the desktop app). Register it as a stdio connector bound to
 * that device:
 *
 *   command: bun   args: [<repo>/e2e/fixtures/mcpApps/stdio-relay-server.mts]
 *
 * - `relay_show_inline` renders an inline view.
 * - `relay_show_panel` prefers the side panel (fullscreen) and is a thread
 *   entrypoint, so it can also be opened from the conversation's app menu.
 * - `relay_frame` is app-only: the view polls it for "frames" of a chosen size
 *   (an image block of random bytes, base64) and shows calls per second, the
 *   round trip, and whether the frame came back inline (base64) or was
 *   uploaded as a file, which a view's call must never do.
 *
 * Every call is appended to `MCP_RELAY_FIXTURE_LOG` (default
 * `/tmp/mcp-relay-fixture-calls.jsonl`) with this process's pid, so a test can
 * tell which process served which call.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const MIME = 'text/html;profile=mcp-app';
const LOG = process.env.MCP_RELAY_FIXTURE_LOG ?? '/tmp/mcp-relay-fixture-calls.jsonl';
const startedAt = new Date().toISOString();

const record = (tool: string, args: unknown) => {
  try {
    appendFileSync(
      LOG,
      `${JSON.stringify({ args, at: new Date().toISOString(), pid: process.pid, tool })}\n`,
    );
  } catch {
    // The log is a test aid only
  }
};

const view = (mode: 'inline' | 'fullscreen') => `<!doctype html>
<html><head><meta charset="utf-8"><style>
body{font:14px system-ui,sans-serif;margin:12px;color:#222}
@media (prefers-color-scheme:dark){body{color:#eee}}
button,select{font:inherit;margin:2px}
#stats{font-family:ui-monospace,monospace;white-space:pre-wrap}
</style></head><body>
<h3 data-testid="relay-title">Relay fixture (${mode})</h3>
<div>server pid: <b data-testid="relay-pid">${process.pid}</b> · started ${startedAt}</div>
<div>tool result: <span data-testid="relay-result">waiting…</span></div>
<div>
  <select data-testid="relay-size">
    <option value="51200">50 KB</option><option value="204800">200 KB</option><option value="512000">500 KB</option>
  </select>
  <button data-testid="relay-call">Call app tool</button>
  <button data-testid="relay-loop">Start loop</button>
  <button data-testid="relay-stop">Stop</button>
</div>
<div id="stats" data-testid="relay-stats"></div>
<script>
(() => {
  let next = 1; const pending = new Map(); let looping = false;
  const stats = document.querySelector('#stats');
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = next++; pending.set(id, { resolve, reject });
    window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
  });
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const m = event.data; if (!m || m.jsonrpc !== '2.0') return;
    if (m.method === 'ui/notifications/tool-result') {
      const text = (m.params?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(' ');
      document.querySelector('[data-testid="relay-result"]').textContent = text || '(no text)';
      return;
    }
    if (m.method === 'ui/resource-teardown' && m.id !== undefined) {
      looping = false; window.parent.postMessage({ jsonrpc: '2.0', id: m.id, result: {} }, '*'); return;
    }
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result ?? {});
    }
  });
  const size = () => Number(document.querySelector('[data-testid="relay-size"]').value);
  const callOnce = async () => {
    const t0 = performance.now();
    const result = await request('tools/call', { name: 'relay_frame', arguments: { bytes: size() } });
    const ms = performance.now() - t0;
    const image = (result.content ?? []).find((b) => b.type === 'image');
    const text = (result.content ?? []).find((b) => b.type === 'text')?.text ?? '';
    return { inline: !!image?.data, ms, isError: !!result.isError, len: image?.data?.length ?? 0, text };
  };
  const show = (lines) => { stats.textContent = lines.join('\\n'); };
  document.querySelector('[data-testid="relay-call"]').onclick = async () => {
    try {
      const r = await callOnce();
      show([
        'calls: 1', 'last: ' + r.text, 'round trip: ' + r.ms.toFixed(0) + ' ms',
        'frame: ' + (r.inline ? 'inline base64 ' + r.len + ' chars' : 'NOT inline'), r.isError ? 'ERROR' : 'ok',
      ]);
    } catch (error) { show(['call failed: ' + error.message]); }
  };
  document.querySelector('[data-testid="relay-stop"]').onclick = () => { looping = false; };
  document.querySelector('[data-testid="relay-loop"]').onclick = async () => {
    if (looping) return; looping = true;
    const start = performance.now(); const times = []; let errors = 0; let notInline = 0; let last = '';
    while (looping) {
      try {
        const r = await callOnce(); times.push(r.ms); last = r.text;
        if (r.isError) errors++; if (!r.inline) notInline++;
      } catch (error) { errors++; last = error.message; }
      const elapsed = (performance.now() - start) / 1000;
      const sorted = [...times].sort((a, b) => a - b);
      const pct = (q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(0) : '-';
      show([
        'calls: ' + times.length + ' in ' + elapsed.toFixed(1) + ' s', 'fps: ' + (times.length / elapsed).toFixed(2),
        'p50: ' + pct(0.5) + ' ms  p90: ' + pct(0.9) + ' ms', 'errors: ' + errors + '  not inline: ' + notInline, 'last: ' + last,
      ]);
    }
  };
  request('ui/initialize', {
    protocolVersion: '2026-01-26',
    appInfo: { name: 'relay fixture', version: '1.0.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
  }).then(() => window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*'));
})();
</script></body></html>`;

const server = new McpServer({ name: 'mcp-relay-fixture', version: '1.0.0' });

for (const mode of ['inline', 'fullscreen'] as const) {
  const uri = `ui://relay/${mode}`;
  const meta = {
    'lobehub/ui': { availableDisplayModes: ['inline', 'fullscreen'] },
    'ui': { prefersBorder: true },
  };
  server.registerResource(`relay-${mode}`, uri, { _meta: meta, mimeType: MIME }, async () => ({
    contents: [{ _meta: meta, mimeType: MIME, text: view(mode), uri }],
  }));
}

server.registerTool(
  'relay_show_inline',
  {
    _meta: {
      'lobehub/ui': { preferredModelDisplayMode: 'inline' },
      'ui': { resourceUri: 'ui://relay/inline' },
    },
    description: 'Show the relay fixture inline view.',
    inputSchema: {},
  },
  async (args) => {
    record('relay_show_inline', args);
    return { content: [{ text: `relay inline view from pid ${process.pid}`, type: 'text' }] };
  },
);

server.registerTool(
  'relay_show_panel',
  {
    _meta: {
      'lobehub/ui': { entrypoints: [{ type: 'thread' }], preferredModelDisplayMode: 'fullscreen' },
      'ui': { resourceUri: 'ui://relay/fullscreen' },
    },
    description: 'Show the relay fixture panel view in the side panel.',
    inputSchema: {},
  },
  async (args) => {
    record('relay_show_panel', args);
    return { content: [{ text: `relay panel view from pid ${process.pid}`, type: 'text' }] };
  },
);

let frames = 0;
server.registerTool(
  'relay_frame',
  {
    _meta: { ui: { resourceUri: 'ui://relay/fullscreen', visibility: ['app'] } },
    description: 'App-only: return a frame of the requested size.',
    inputSchema: { bytes: z.number().optional() },
  },
  async (args: { bytes?: number }) => {
    const bytes = Math.max(1, Math.min(Number(args?.bytes) || 51_200, 4 * 1024 * 1024));
    frames += 1;
    record('relay_frame', { bytes });
    return {
      content: [
        { text: `frame ${frames} (${bytes} bytes) from pid ${process.pid}`, type: 'text' },
        { data: randomBytes(bytes).toString('base64'), mimeType: 'image/jpeg', type: 'image' },
      ],
    };
  },
);

await server.connect(new StdioServerTransport());

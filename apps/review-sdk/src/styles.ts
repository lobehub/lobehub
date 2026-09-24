/**
 * All toolbar styling lives inside its shadow root, so the host page's CSS
 * never reaches in and ours never leaks out. Colors follow the reviewer's
 * light/dark preference.
 */
export const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif; }
.root {
  --bg: #ffffff; --bg-soft: #f5f5f5; --text: #1f1f1f; --muted: #6b6b6b; --border: rgba(0,0,0,.1);
  --accent: #111; --accent-text: #fff; --danger: #f5222d; --shadow: 0 8px 28px rgba(0,0,0,.16);
  color: var(--text); font-size: 13px; line-height: 1.5;
}
@media (prefers-color-scheme: dark) {
  .root { --bg: #1c1c1c; --bg-soft: #262626; --text: #ededed; --muted: #9a9a9a; --border: rgba(255,255,255,.12); --accent: #fafafa; --accent-text: #111; }
}
button { cursor: pointer; font: inherit; color: inherit; border: 1px solid var(--border); background: var(--bg); border-radius: 8px; padding: 4px 10px; min-height: 28px; }
button:hover:not(:disabled) { background: var(--bg-soft); }
button:disabled { cursor: not-allowed; opacity: .45; }
button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
button.primary:hover:not(:disabled) { opacity: .88; background: var(--accent); }
button.text { border-color: transparent; background: transparent; }
button:focus-visible, textarea:focus-visible { outline: 2px solid #4096ff; outline-offset: 1px; }
textarea { width: 100%; resize: vertical; font: inherit; color: var(--text); background: var(--bg-soft); border: 1px solid var(--border); border-radius: 8px; padding: 8px; min-height: 72px; }
.launcher { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; border-radius: 999px; padding: 8px 14px; box-shadow: var(--shadow); display: flex; gap: 6px; align-items: center; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); flex: none; }
.toolbar { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 2147483001; display: flex; gap: 10px; align-items: center; padding: 6px 6px 6px 14px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg); box-shadow: var(--shadow); white-space: nowrap; }
.hint { color: var(--muted); }
.highlight { position: fixed; pointer-events: none; z-index: 2147482999; border: 2px solid var(--danger); border-radius: 4px; background: rgba(245,34,45,.08); transition: all 80ms ease-out; }
.pin { position: fixed; pointer-events: none; z-index: 2147482999; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 600; color: #fff; background: var(--danger); border: 2px solid var(--bg); }
.composer { position: fixed; z-index: 2147483002; width: 340px; padding: 12px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg); box-shadow: var(--shadow); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row { display: flex; gap: 8px; align-items: center; }
.end { justify-content: flex-end; }
.between { justify-content: space-between; }
.panel { position: fixed; top: 0; right: 0; bottom: 0; width: 400px; max-width: 100vw; z-index: 2147483003; display: flex; flex-direction: column; background: var(--bg); border-left: 1px solid var(--border); box-shadow: var(--shadow); }
.panel header { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px; }
.panel header strong { font-size: 15px; }
.panel .list { flex: 1; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.panel footer { padding: 12px 16px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
.item { border: 1px solid var(--border); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.item img { width: 100%; max-height: 160px; object-fit: cover; object-position: top; border-radius: 6px; border: 1px solid var(--border); }
.item p { margin: 0; white-space: pre-wrap; }
.muted { color: var(--muted); }
.notice { padding: 8px 10px; border-radius: 8px; background: var(--bg-soft); color: var(--muted); }
.toast { position: fixed; left: 50%; top: 20px; transform: translateX(-50%); z-index: 2147483004; padding: 8px 14px; border-radius: 8px; background: var(--accent); color: var(--accent-text); box-shadow: var(--shadow); }
.connect { position: fixed; right: 20px; bottom: 72px; z-index: 2147483002; width: 320px; padding: 14px; display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg); box-shadow: var(--shadow); }
`;

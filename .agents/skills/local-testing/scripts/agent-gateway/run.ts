// CLI for the agent-gateway probe.
//
// Bundles the TS probes with esbuild, pipes them into `agent-browser eval`,
// and persists dumps under `.agent-gateway/` (gitignored) for later use as
// streaming-replay test fixtures.
//
// Commands:
//   bun run .agents/skills/local-testing/scripts/agent-gateway/run.ts install
//       Bundle probe-events.ts and inject into the CDP-attached browser.
//       Re-installing clears all buffers and re-patches WebSocket / fetch.
//
//   bun run .agents/skills/local-testing/scripts/agent-gateway/run.ts dump [name]
//       Stop the timeline timer, fetch the capture as JSON, write it to
//       `.agent-gateway/<name>-<YYYYMMDD-HHmmss>.json`. `name` defaults to
//       `dump`. Prints the absolute path written.
//
//   bun run .agents/skills/local-testing/scripts/agent-gateway/run.ts analyze [path]
//       Run analyze-events.ts on the dump. `path` defaults to the most
//       recently modified file in `.agent-gateway/`.
//
// Optional flags:
//   --cdp <port>     CDP port (default 9222)
//   --browser <bin>  agent-browser binary (default 'agent-browser')

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// .agents/skills/local-testing/scripts/agent-gateway/ → 5 levels up
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../../../../..');
const DUMP_DIR = path.join(PROJECT_ROOT, '.agent-gateway');

interface Flags {
  browser: string;
  cdp: string;
  positional: string[];
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = { cdp: '9222', browser: 'agent-browser', positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cdp') out.cdp = argv[++i] ?? out.cdp;
    else if (a === '--browser') out.browser = argv[++i] ?? out.browser;
    else out.positional.push(a);
  }
  return out;
}

async function bundle(entry: string): Promise<string> {
  // Bun.build is built into the Bun runtime — no external dep needed.
  const r = await Bun.build({
    entrypoints: [path.join(SCRIPT_DIR, entry)],
    target: 'browser',
    format: 'esm',
    minify: false,
  });
  if (!r.success) {
    const msgs = r.logs.map((l) => `${l.level}: ${l.message}`).join('\n');
    throw new Error(`bundle failed for ${entry}:\n${msgs}`);
  }
  return await r.outputs[0].text();
}

function wrapIife(body: string, returnExpr: string): string {
  // Wrap as an IIFE that swallows the bundled top-level (top-level `const`
  // declarations get scoped to the IIFE, so re-injection doesn't conflict)
  // and returns the configured expression — which `agent-browser eval`
  // captures and prints to stdout.
  return `(() => {\n${body}\n;return ${returnExpr};\n})()`;
}

function runAgentBrowserEval(flags: Flags, script: string): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(flags.browser, ['--cdp', flags.cdp, 'eval', '--stdin'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', rejectP);
    child.on('close', (code) => {
      if (code === 0) resolveP(stdout);
      else rejectP(new Error(`agent-browser exited ${code}`));
    });
    child.stdin.write(script);
    child.stdin.end();
  });
}

// agent-browser prints eval results as JSON (string values are quoted).
function unquoteAgentBrowserResult(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      /* fall through */
    }
  }
  return trimmed;
}

function isoStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function ensureDumpDir(): void {
  mkdirSync(DUMP_DIR, { recursive: true });
}

function latestDump(): string | null {
  ensureDumpDir();
  const entries = readdirSync(DUMP_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, mtime: statSync(path.join(DUMP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0] ? path.join(DUMP_DIR, entries[0].f) : null;
}

// ── Commands ────────────────────────────────────────────────────────

async function cmdInstall(flags: Flags): Promise<void> {
  const body = await bundle('probe-events.ts');
  const installMsg = JSON.stringify(
    'events probe installed: WebSocket+fetch interception. ' +
      'WS captures operationId= sockets (gateway), fetch captures /api/agent/stream (direct).',
  );
  const script = wrapIife(body, installMsg);
  const out = await runAgentBrowserEval(flags, script);
  console.log(unquoteAgentBrowserResult(out));
}

async function cmdDump(flags: Flags): Promise<void> {
  const name = flags.positional[1] ?? 'dump';
  const body = await bundle('probe-dump.ts');
  const script = wrapIife(body, 'window.__PROBE_LAST_DUMP_JSON');
  const raw = await runAgentBrowserEval(flags, script);
  const json = unquoteAgentBrowserResult(raw);
  ensureDumpDir();
  const filename = `${name}-${isoStamp()}.json`;
  const dumpPath = path.join(DUMP_DIR, filename);
  writeFileSync(dumpPath, json, 'utf8');
  // Validate by parsing the meta header so we error early on bad capture
  try {
    const parsed = JSON.parse(json) as {
      meta?: { eventCount?: number; callCount?: number; sampleCount?: number };
    };
    const meta = parsed.meta ?? {};
    console.log(
      `wrote ${dumpPath}  (${json.length} bytes  events=${meta.eventCount ?? '?'}  ` +
        `calls=${meta.callCount ?? '?'}  samples=${meta.sampleCount ?? '?'})`,
    );
  } catch {
    console.log(`wrote ${dumpPath}  (${json.length} bytes — JSON.parse failed; see file)`);
  }
}

async function cmdAnalyze(flags: Flags): Promise<void> {
  const target = flags.positional[1] ?? latestDump();
  if (!target) {
    console.error('no dump file found. run `dump` first or pass a path.');
    process.exit(1);
  }
  const child = spawn('bun', ['run', path.join(SCRIPT_DIR, 'analyze-events.ts'), target], {
    stdio: 'inherit',
  });
  await new Promise<void>((resolveP, rejectP) => {
    child.on('error', rejectP);
    child.on('close', (code) => (code === 0 ? resolveP() : rejectP(new Error(`exit ${code}`))));
  });
}

// ── Entry point ─────────────────────────────────────────────────────

const flags = parseFlags(process.argv.slice(2));
const cmd = flags.positional[0];

const usage = `usage:
  bun run run.ts install [--cdp 9222]
  bun run run.ts dump [name] [--cdp 9222]
  bun run run.ts analyze [path]
`;

if (!cmd) {
  console.error(usage);
  process.exit(1);
}

try {
  if (cmd === 'install') await cmdInstall(flags);
  else if (cmd === 'dump') await cmdDump(flags);
  else if (cmd === 'analyze') await cmdAnalyze(flags);
  else {
    console.error(`unknown command: ${cmd}\n\n${usage}`);
    process.exit(1);
  }
} catch (e: any) {
  console.error(e?.stack ?? e);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * agent-browser-klm.mjs
 *
 * Thin wrapper around `agent-browser` that records each executed command as an
 * interaction atom for GOMS-KLM analysis. Unknown flags are forwarded.
 *
 * Browser output is captured through temp files rather than pipes: the
 * agent-browser daemon can inherit and hold the child's stdio descriptors, so a
 * pipe might never reach EOF and `spawnSync` would block on it. A file has no
 * such dependency. The output is attached to the trace atom, and on failure it
 * is echoed to stderr — a swallowed error reads exactly like a successful step
 * (the page simply never navigated), which is far worse than noisy output.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'lobehub.agentBrowserKlmTrace@1';
const DEFAULT_TRACE = '.records/interaction-trace.jsonl';

// Enough to carry an agent-browser diagnostic; keeps one JSONL atom on one line.
const MAX_CAPTURED_CHARS = 4000;

const optionValueFlags = new Set([
  '--browser',
  '--cdp',
  '--device',
  '--engine',
  '--args',
  '--host',
  '--port',
  '--profile',
  '--proxy',
  '--proxy-bypass',
  '--session',
  '--session-name',
  '--state',
  '--timeout',
  '--url',
  '--user-data-dir',
  '--executable-path',
  '--extension',
  '--headers',
  '--user-agent',
  '--screenshot-dir',
  '--screenshot-quality',
  '--screenshot-format',
  '--download-path',
  '--allowed-domains',
  '--action-policy',
  '--confirm-actions',
  '--config',
  '--model',
]);

const forwardedBooleanGlobalFlags = new Set([
  '--auto-connect',
  '--headless',
  '--headed',
  '--no-sandbox',
]);

const defaultOperators = () => ({
  H: 0,
  K: 0,
  M: 0,
  P: 0,
  R_ms: 0,
  T_chars: 0,
});

const usage = () => {
  console.log(`Usage:
  agent-browser-klm.mjs [--klm-trace file] [--klm-phase id] [--klm-check id] [--klm-command-timeout-ms ms] -- <agent-browser args...>
  agent-browser-klm.mjs mental [--m n] [--reason text] [--confidence n] [--score n] [--klm-trace file]

Examples:
  AGENT_BROWSER_KLM_TRACE="$DIR/interaction-trace.jsonl" \\
    agent-browser-klm.mjs --klm-phase login --klm-check case-1 --session app-dev click @e3

  agent-browser-klm.mjs mental --m 2 --score 3 --confidence 0.75 \\
    --reason "First view requires understanding status and next action"`);
};

const parseNumber = (value, fallback) => {
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const parseOwnFlags = (argv) => {
  const meta = {
    checkItemId: process.env.AGENT_BROWSER_KLM_CHECK || process.env.KLM_CHECK_ITEM_ID,
    label: process.env.AGENT_BROWSER_KLM_LABEL || process.env.KLM_LABEL,
    phaseId: process.env.AGENT_BROWSER_KLM_PHASE || process.env.KLM_PHASE_ID,
    surface: process.env.AGENT_BROWSER_KLM_SURFACE || process.env.KLM_SURFACE || 'web',
    commandTimeoutMs: parseNumber(process.env.AGENT_BROWSER_KLM_COMMAND_TIMEOUT_MS, undefined),
    trace:
      process.env.AGENT_BROWSER_KLM_TRACE ||
      process.env.INTERACTION_TRACE ||
      path.resolve(process.cwd(), DEFAULT_TRACE),
  };
  let binary = process.env.AGENT_BROWSER_BIN || 'agent-browser';
  const forwarded = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      forwarded.push(...argv.slice(index + 1));
      break;
    }

    if (arg === '--klm-help' || arg === '-h') {
      usage();
      process.exit(0);
    }

    if (arg === '--klm-trace') meta.trace = path.resolve(argv[++index] ?? DEFAULT_TRACE);
    else if (arg === '--klm-phase') meta.phaseId = argv[++index];
    else if (arg === '--klm-label') meta.label = argv[++index];
    else if (arg === '--klm-check') meta.checkItemId = argv[++index];
    else if (arg === '--klm-surface') meta.surface = argv[++index] ?? meta.surface;
    else if (arg === '--klm-command-timeout-ms')
      meta.commandTimeoutMs = parseNumber(argv[++index], meta.commandTimeoutMs);
    else if (arg === '--klm-agent-browser') binary = argv[++index] ?? binary;
    else forwarded.push(arg);
  }

  return { binary, forwarded, meta };
};

const appendEvent = async (trace, event) => {
  await mkdir(path.dirname(path.resolve(trace)), { recursive: true });
  await appendFile(trace, `${JSON.stringify(event)}\n`, 'utf8');
};

const findCommandIndex = (args) => {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--') continue;
    if (optionValueFlags.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      if (!forwardedBooleanGlobalFlags.has(arg) && arg.includes('=')) continue;
      continue;
    }
    if (arg.startsWith('-')) continue;

    return index;
  }

  return -1;
};

const normalizeCommand = (args) => {
  const index = findCommandIndex(args);
  if (index < 0) return { argsAfterCommand: [], command: null };
  return {
    argsAfterCommand: args.slice(index + 1),
    command: args[index],
  };
};

const textLength = (value) => (typeof value === 'string' ? [...value].length : 0);

const lastNonFlag = (args) => {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const arg = args[index];
    if (!arg.startsWith('-')) return arg;
  }
};

const numericWaitMs = (args) => {
  const direct = args.find((arg) => /^\d+(?:\.\d+)?$/.test(arg));
  return direct ? Number(direct) : undefined;
};

const classifyFindCommand = (args) => {
  const action = [...args]
    .reverse()
    .find((arg) => ['check', 'click', 'fill', 'press', 'select', 'type'].includes(arg));
  if (!action)
    return {
      assumptions: ['Semantic lookup only; no user-equivalent action counted.'],
      category: 'probe',
      operators: defaultOperators(),
    };

  return classifyCommand(action, args.slice(args.indexOf(action) + 1), 0);
};

function classifyCommand(command, args, durationMs) {
  const operators = defaultOperators();
  const assumptions = [];
  let category = 'probe';

  switch (command) {
    case 'check':
    case 'click':
    case 'download':
    case 'select': {
      operators.P = 1;
      operators.K = 1;
      category = 'interaction';
      assumptions.push(`${command} maps to pointer acquisition plus one activation.`);
      break;
    }

    case 'dblclick': {
      operators.P = 1;
      operators.K = 2;
      category = 'interaction';
      assumptions.push('dblclick maps to pointer acquisition plus two activations.');
      break;
    }

    case 'fill':
    case 'type': {
      operators.P = 1;
      operators.T_chars = textLength(lastNonFlag(args));
      category = 'interaction';
      assumptions.push(`${command} maps to pointer acquisition plus user-equivalent text entry.`);
      break;
    }

    case 'keyboard': {
      const subcommand = args[0];
      if (subcommand === 'type' || subcommand === 'inserttext') {
        operators.T_chars = textLength(args.at(-1));
        category = 'interaction';
        assumptions.push(`keyboard ${subcommand} maps to user-equivalent text entry.`);
      } else if (subcommand === 'press') {
        operators.K = 1;
        category = 'interaction';
        assumptions.push('keyboard press maps to one keystroke.');
      }
      break;
    }

    case 'press': {
      operators.K = 1;
      category = 'interaction';
      assumptions.push('press maps to one keystroke.');
      break;
    }

    case 'scroll': {
      operators.P = 1;
      operators.K = 1;
      category = 'interaction';
      assumptions.push('scroll maps to target acquisition plus one wheel/gesture action.');
      break;
    }

    case 'open':
    case 'goto':
    case 'navigate': {
      operators.R_ms = Math.max(0, Math.round(durationMs));
      category = 'navigation';
      assumptions.push('Direct navigation is counted as system response time, not URL typing.');
      break;
    }

    case 'wait': {
      operators.R_ms = Math.max(0, Math.round(numericWaitMs(args) ?? durationMs));
      category = 'wait';
      assumptions.push('wait maps to system response time.');
      break;
    }

    case 'find': {
      return classifyFindCommand(args);
    }

    case 'screenshot':
    case 'pdf': {
      category = 'evidence';
      assumptions.push(
        `${command} is evidence capture and is not counted as user-side interaction.`,
      );
      break;
    }

    case 'snapshot':
    case 'eval':
    case 'get':
    case 'network':
    case 'stream': {
      category = 'probe';
      assumptions.push(
        `${command} is an agent probe and is not counted unless paired with a mental estimate.`,
      );
      break;
    }

    default: {
      category = 'unknown';
      assumptions.push('Unknown agent-browser command; no user-equivalent operators inferred.');
    }
  }

  return { assumptions, category, operators };
}

const buildPhase = (meta) => {
  if (!meta.phaseId && !meta.label && !meta.checkItemId) return undefined;
  return {
    checkItemId: meta.checkItemId,
    id: meta.phaseId ?? meta.checkItemId ?? 'unscoped',
    label: meta.label,
  };
};

const readCapture = (file) => {
  try {
    const text = readFileSync(file, 'utf8').trim();
    if (!text) return undefined;
    return text.length > MAX_CAPTURED_CHARS
      ? `${text.slice(0, MAX_CAPTURED_CHARS)}… [truncated]`
      : text;
  } catch {
    return undefined;
  }
};

const spawnCapturing = (binary, args, timeout) => {
  const captureDir = mkdtempSync(path.join(tmpdir(), 'agent-browser-klm-'));
  const stdoutPath = path.join(captureDir, 'stdout.log');
  const stderrPath = path.join(captureDir, 'stderr.log');
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  let open = true;
  const closeBoth = () => {
    if (!open) return;
    open = false;
    closeSync(stdoutFd);
    closeSync(stderrFd);
  };

  try {
    const result = spawnSync(binary, args, {
      killSignal: 'SIGKILL',
      stdio: ['ignore', stdoutFd, stderrFd],
      timeout,
    });
    // Close before reading so a SIGKILLed child's last writes are flushed.
    closeBoth();
    return { result, stderr: readCapture(stderrPath), stdout: readCapture(stdoutPath) };
  } finally {
    closeBoth();
    rmSync(captureDir, { force: true, recursive: true });
  }
};

const runAgentBrowser = async (binary, args, meta) => {
  if (args.length === 0) {
    usage();
    process.exit(1);
  }

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const { argsAfterCommand, command } = normalizeCommand(args);

  const { result, stderr, stdout } = spawnCapturing(
    binary,
    args,
    meta.commandTimeoutMs && meta.commandTimeoutMs > 0 ? meta.commandTimeoutMs : undefined,
  );

  if (result.error && result.error.code !== 'ETIMEDOUT') {
    console.error(`[agent-browser-klm] failed to start ${binary}:`, result.error.message);
  }

  const timedOut = result.error?.code === 'ETIMEDOUT';
  const exitCode = timedOut ? 124 : (result.status ?? (result.error ? 127 : 1));

  const completedAtMs = Date.now();
  const durationMs = completedAtMs - startedAtMs;
  const klm = classifyCommand(command, argsAfterCommand, durationMs);
  if (timedOut) {
    klm.category = 'blocked';
    klm.operators = defaultOperators();
    klm.assumptions.push('agent-browser command timed out; no user-equivalent cost counted.');
  } else if (exitCode !== 0) {
    // The action never happened, so charging it as a completed interaction (or
    // as navigation response time) would inflate the cost model with phantom work.
    klm.category = 'blocked';
    klm.operators = defaultOperators();
    klm.assumptions.push(
      `agent-browser exited ${exitCode}; the action did not happen, so no user-equivalent cost counted.`,
    );
  }

  if (exitCode !== 0) {
    const detail = stderr ?? stdout;
    console.error(
      `[agent-browser-klm] ${binary} ${command ?? '<no command>'} exited ${exitCode}` +
        (detail ? `:\n${detail}` : ' with no output.'),
    );
  }

  const event = {
    agentBrowser: { args, command },
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs,
    exitCode,
    id: randomUUID(),
    klm,
    phase: buildPhase(meta),
    schema: SCHEMA,
    source: 'agent-browser',
    startedAt,
    stderr,
    stdout,
    surface: meta.surface,
    timedOut,
    type: 'agent_browser_action',
  };

  await appendEvent(meta.trace, event);
  process.exit(exitCode);
};

const recordMentalEstimate = async (argv, baseMeta) => {
  const mental = {
    confidence: undefined,
    mOperators: 1,
    reason: undefined,
    score: undefined,
  };

  const { meta } = parseOwnFlags(argv);
  const mergedMeta = { ...baseMeta, ...meta };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--m') mental.mOperators = parseNumber(argv[++index], mental.mOperators);
    else if (arg === '--reason') mental.reason = argv[++index];
    else if (arg === '--confidence') mental.confidence = parseNumber(argv[++index], undefined);
    else if (arg === '--score') mental.score = parseNumber(argv[++index], undefined);
  }

  const operators = defaultOperators();
  operators.M = mental.mOperators;
  await appendEvent(mergedMeta.trace, {
    id: randomUUID(),
    klm: {
      assumptions: ['Mental operators are estimated by the agent from the observed page/context.'],
      category: 'mental',
      operators,
    },
    mentalEstimate: mental,
    phase: buildPhase(mergedMeta),
    recordedAt: new Date().toISOString(),
    schema: SCHEMA,
    source: 'agent',
    surface: mergedMeta.surface,
    type: 'mental_estimate',
  });
};

const main = async () => {
  const argv = process.argv.slice(2);
  if (argv[0] === '--klm-help' || argv[0] === '-h') {
    usage();
    return;
  }

  if (argv[0] === 'mental') {
    const { meta } = parseOwnFlags(argv.slice(1));
    await recordMentalEstimate(argv.slice(1), meta);
    return;
  }

  const { binary, forwarded, meta } = parseOwnFlags(argv);
  await runAgentBrowser(binary, forwarded, meta);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[agent-browser-klm]', error);
    process.exit(1);
  });
}

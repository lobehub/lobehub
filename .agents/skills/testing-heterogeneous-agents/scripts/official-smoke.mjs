#!/usr/bin/env node
/**
 * Exercise every server-advertised LobeHub official-provider model through the
 * real Desktop heterogeneous-agent IPC path.
 *
 * This harness never invokes an installer, updater command, or sign-in flow.
 * Missing CLIs are reported as blocked. `run` requires an explicit
 * `--confirm-live` because every matrix cell makes a real model request.
 *
 * Usage:
 *   node .agents/skills/testing-heterogeneous-agents/scripts/official-smoke.mjs list
 *   node .agents/skills/testing-heterogeneous-agents/scripts/official-smoke.mjs run \
 *     --confirm-live [--topic-id <id>] [--cdp 9222]
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const AGENTS = {
  'claude-code': {
    command: 'claude',
    ingress: 'anthropic-messages',
    title: 'Claude Code',
  },
  'codex': { command: 'codex', ingress: 'openai-responses', title: 'Codex' },
  'grok-build': { command: 'grok', ingress: 'openai-responses', title: 'Grok Build' },
  'kimi-code': { command: 'kimi', ingress: 'anthropic-messages', title: 'Kimi Code' },
  'pi': { command: 'pi', ingress: 'openai-responses', title: 'Pi' },
  'trae': { command: 'traecli', ingress: 'openai-responses', title: 'TRAE' },
};

const AGENT_TYPES = Object.keys(AGENTS);
const CASE_RUNS_KEY = '__LOBE_HETERO_OFFICIAL_SMOKE_RUNS';
const DEFAULT_TIMEOUT_SECONDS = 180;
const DEFAULT_CDP_PORT = 9222;
const POLL_INTERVAL_MS = 500;

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

const usage = `Usage:
  node .agents/skills/testing-heterogeneous-agents/scripts/official-smoke.mjs list [options]
  node .agents/skills/testing-heterogeneous-agents/scripts/official-smoke.mjs run --confirm-live [options]

Commands:
  list                 Read the server model matrix and detect existing CLIs. No model calls.
  run                  Execute every selected matrix cell and write an acceptance report.

Options:
  --agent <types>       Comma-separated agent filter (${AGENT_TYPES.join(', ')}).
  --browser <path>      agent-browser executable (default: agent-browser).
  --cdp <port>          Electron CDP port (default: ${DEFAULT_CDP_PORT}).
  --cwd <path>          Working directory passed to each CLI (default: isolated report workspace).
  --json                Print list output as JSON.
  --model <ids>         Comma-separated exact model-id filter.
  --report-dir <path>   Exact report output directory (default: .records/reports/<timestamp>-...).
  --subject <type:id>   Optional acceptance subject written to result.json.
  --timeout <seconds>   Per-cell timeout (default: ${DEFAULT_TIMEOUT_SECONDS}).
  --topic-id <id>       Existing personal topic; defaults to the active Electron topic.
  --confirm-live        Required by run. Confirms real official-provider requests and usage.

Safety:
  This harness invokes no installer/updater command and reads no custom provider API keys.
  Claude runs receive DISABLE_AUTOUPDATER=1 and DISABLE_UPDATES=1.
  Missing CLIs are marked blocked. Runs are sequential to avoid profile and quota contention.
`;

const fail = (message, exitCode = 1) => {
  console.error(`official-smoke: ${message}`);
  process.exit(exitCode);
};

const parseCsv = (value) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const parseArgs = (argv) => {
  const command = argv[0];
  if (command === '--help' || command === '-h') {
    console.log(usage);
    process.exit(0);
  }

  const options = {
    agents: [],
    browser: 'agent-browser',
    cdp: DEFAULT_CDP_PORT,
    confirmLive: false,
    cwd: undefined,
    json: false,
    models: [],
    reportDir: undefined,
    subject: undefined,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    topicId: undefined,
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value || value.startsWith('--')) fail(`${arg} requires a value`, 2);
      return value;
    };

    switch (arg) {
      case '--agent': {
        options.agents.push(...parseCsv(next()));
        break;
      }
      case '--browser': {
        options.browser = next();
        break;
      }
      case '--cdp': {
        options.cdp = Number(next());
        break;
      }
      case '--confirm-live': {
        options.confirmLive = true;
        break;
      }
      case '--cwd': {
        options.cwd = path.resolve(next());
        break;
      }
      case '--json': {
        options.json = true;
        break;
      }
      case '--model': {
        options.models.push(...parseCsv(next()));
        break;
      }
      case '--report-dir': {
        options.reportDir = path.resolve(next());
        break;
      }
      case '--subject': {
        options.subject = next();
        break;
      }
      case '--timeout': {
        options.timeoutSeconds = Number(next());
        break;
      }
      case '--topic-id': {
        options.topicId = next();
        break;
      }
      case '--help':
      case '-h': {
        console.log(usage);
        process.exit(0);
        break;
      }
      default: {
        fail(`unknown option: ${arg}\n\n${usage}`, 2);
      }
    }
  }

  if (!['list', 'run'].includes(command)) fail(`choose list or run\n\n${usage}`, 2);
  if (!Number.isInteger(options.cdp) || options.cdp <= 0)
    fail('--cdp must be a positive integer', 2);
  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0) {
    fail('--timeout must be a positive number', 2);
  }
  if (options.subject && !/^(?:task|topic|document):.+$/.test(options.subject)) {
    fail('--subject must be task:<id>, topic:<id>, or document:<id>', 2);
  }

  const unknownAgents = options.agents.filter((agent) => !AGENT_TYPES.includes(agent));
  if (unknownAgents.length > 0) fail(`unknown agent type(s): ${unknownAgents.join(', ')}`, 2);

  options.agents = [...new Set(options.agents)];
  options.models = [...new Set(options.models)];
  return { command, options };
};

const runAgentBrowserEval = (options, script, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      options.browser,
      [
        '--session',
        `hetero-official-smoke-${options.cdp}`,
        '--cdp',
        String(options.cdp),
        'eval',
        '--stdin',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stderr = '';
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`agent-browser timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`agent-browser exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
    child.stdin.end(script);
  });

const parseAgentBrowserJson = (raw) => {
  let value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
  return JSON.parse(value);
};

const buildPreflightScript = (topicId) => {
  const descriptors = Object.fromEntries(
    Object.entries(AGENTS).map(([agentType, descriptor]) => [agentType, descriptor.command]),
  );
  return `
(async function () {
  const invoke = window.electronAPI && window.electronAPI.invoke;
  const ipc = window.electron && window.electron.ipcRenderer;
  const stores = window.__LOBE_STORES;
  if (!invoke || !ipc) throw new Error('Electron preload IPC is unavailable; attach to the app renderer target.');
  if (!stores || !stores.user || !stores.chat) throw new Error('LobeHub stores are unavailable; wait for the app to finish loading.');

  const user = stores.user();
  const chat = stores.chat();
  const selectedTopicId = ${JSON.stringify(topicId)} || chat.activeTopicId || null;
  const input = encodeURIComponent(JSON.stringify({ json: {} }));
  const response = await fetch('/trpc/lambda/aiAgent.getServerDefaultHeterogeneousCapability?input=' + input, {
    credentials: 'include',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.error) {
    const detail = payload && payload.error ? JSON.stringify(payload.error) : response.statusText;
    throw new Error('Official capability request failed (' + response.status + '): ' + detail);
  }
  const capability = payload.result && payload.result.data && payload.result.data.json;
  if (!capability) throw new Error('Official capability response had no result.data.json payload.');

  const descriptors = ${JSON.stringify(descriptors)};
  const binaries = {};
  for (const [agentType, command] of Object.entries(descriptors)) {
    if (!capability.agents.includes(agentType)) continue;
    try {
      binaries[agentType] = await invoke('binary.detectHeterogeneousAgentCommand', { agentType, command });
    } catch (error) {
      binaries[agentType] = { available: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const remoteConfig = await invoke('remoteServer.getRemoteServerConfig').catch(() => null);
  return JSON.stringify({
    activeAgentId: chat.activeAgentId || null,
    capability,
    binaries,
    electron: window.lobeEnv ? {
      electronVersion: window.lobeEnv.electronVersion,
      platform: window.lobeEnv.platform,
    } : null,
    isSignedIn: Boolean(user.isSignedIn && user.user && user.user.id),
    remoteConfig: remoteConfig ? {
      active: Boolean(remoteConfig.active),
      remoteServerUrl: remoteConfig.remoteServerUrl || null,
      storageMode: remoteConfig.storageMode || null,
    } : null,
    topicId: selectedTopicId,
    userId: user.user && user.user.id || null,
  });
})()
`;
};

const readPreflight = async (options) => {
  const raw = await runAgentBrowserEval(options, buildPreflightScript(options.topicId), 30_000);
  const preflight = parseAgentBrowserJson(raw);
  if (!preflight.isSignedIn)
    fail('Electron is not signed in; restore its login state before retrying', 3);
  if (!preflight.capability?.enabled) {
    fail(
      `the LobeHub official heterogeneous capability is unavailable (${preflight.capability?.reason ?? 'unknown'})`,
      3,
    );
  }
  if (!preflight.capability.models || !Array.isArray(preflight.capability.agents)) {
    fail('the official capability response has no agent/model matrix', 3);
  }
  const unknownAgents = preflight.capability.agents.filter((agent) => !AGENT_TYPES.includes(agent));
  if (unknownAgents.length > 0) {
    fail(
      `the server advertises agent type(s) missing from this harness: ${unknownAgents.join(', ')}`,
      3,
    );
  }
  return preflight;
};

const selectMatrix = (preflight, options) => {
  const advertisedAgents = new Set(preflight.capability.agents);
  const selectedAgents = options.agents.length > 0 ? options.agents : preflight.capability.agents;
  const modelFilter = new Set(options.models);
  const matrix = [];
  const seen = new Set();

  for (const agentType of selectedAgents) {
    if (!advertisedAgents.has(agentType)) continue;
    const models = Array.isArray(preflight.capability.models[agentType])
      ? preflight.capability.models[agentType]
      : [];
    for (const item of models) {
      const model = typeof item?.model === 'string' ? item.model.trim() : '';
      if (!model || (modelFilter.size > 0 && !modelFilter.has(model))) continue;
      const key = `${agentType}\0${model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matrix.push({ agentType, model });
    }
  }

  if (matrix.length === 0)
    fail('the selected filters match no server-advertised agent/model cells', 2);
  return matrix;
};

const printMatrix = (preflight, matrix, json) => {
  const output = {
    binaries: preflight.binaries,
    electron: preflight.electron,
    matrix: matrix.map(({ agentType, model }) => ({
      agentType,
      cliAvailable: preflight.binaries[agentType]?.available === true,
      cliVersion: preflight.binaries[agentType]?.version ?? null,
      model,
    })),
    remoteConfig: preflight.remoteConfig,
    topicId: preflight.topicId,
  };
  if (json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log('LobeHub official heterogeneous-provider matrix');
  console.log(`Server mode: ${preflight.remoteConfig?.storageMode ?? 'unknown'}`);
  console.log(`Topic: ${preflight.topicId ?? '(no active topic; run needs --topic-id)'}`);
  for (const { agentType, model } of matrix) {
    const binary = preflight.binaries[agentType];
    const state = binary?.available
      ? `ready${binary.version ? ` (${binary.version})` : ''}`
      : 'blocked: CLI missing';
    console.log(`- ${AGENTS[agentType].title} / ${model}: ${state}`);
  }
};

const buildCaseStartScript = (input) => `
(function (input) {
  const invoke = window.electronAPI && window.electronAPI.invoke;
  const ipc = window.electron && window.electron.ipcRenderer;
  if (!invoke || !ipc) throw new Error('Electron preload IPC is unavailable.');

  const runs = window[${JSON.stringify(CASE_RUNS_KEY)}] ||= {};
  if (runs[input.operationId]) {
    return JSON.stringify({ state: runs[input.operationId].state });
  }
  const record = runs[input.operationId] = { result: null, state: 'running' };

  void (async () => {
    const startedAt = Date.now();
    const events = [];
    const textChunks = [];
    let caughtError = null;
    let sessionId = null;
    let settlement = null;
    let terminal = null;
    let timer = null;
    let sendPromise = null;

    const errorValue = (error) => ({
      code: error && error.code || null,
      message: error instanceof Error ? error.message : String(error),
    });
    const compactEvent = (event) => {
      const data = event && event.data || {};
      return {
        chunkType: data.chunkType || null,
        content: typeof data.content === 'string' ? data.content.slice(0, 4000) : null,
        error: typeof data.error === 'string' ? data.error.slice(0, 4000) : null,
        message: typeof data.message === 'string' ? data.message.slice(0, 4000) : null,
        model: typeof data.model === 'string' ? data.model : null,
        phase: data.phase || null,
        provider: typeof data.provider === 'string' ? data.provider : null,
        stderr: typeof data.stderr === 'string' ? data.stderr.slice(0, 4000) : null,
        stepIndex: event && event.stepIndex,
        stopReason: typeof data.stopReason === 'string' ? data.stopReason : null,
        type: event && event.type,
      };
    };
    const onEvent = (_event, payload) => {
      if (!payload || payload.sessionId !== sessionId) return;
      const event = payload.event;
      if (events.length < 500) events.push(compactEvent(event));
      if (event && event.type === 'stream_chunk' && event.data && event.data.chunkType === 'text' && typeof event.data.content === 'string') {
        textChunks.push(event.data.content);
      }
    };
    const onComplete = (_event, payload) => {
      if (payload && payload.sessionId === sessionId) terminal = { kind: 'complete' };
    };
    const onError = (_event, payload) => {
      if (payload && payload.sessionId === sessionId) terminal = { error: payload.error, kind: 'error' };
    };

    try {
      const started = await invoke('heterogeneousAgent.startSession', {
        agentType: input.agentType,
        command: input.command,
        cwd: input.cwd,
        env: input.env,
        providerBinding: {
          apiConfig: { model: input.model, source: 'server-default' },
          kind: 'server-default',
        },
      });
      sessionId = started.sessionId;
      ipc.on('heteroAgentEvent', onEvent);
      ipc.on('heteroAgentSessionComplete', onComplete);
      ipc.on('heteroAgentSessionError', onError);

      sendPromise = invoke('heterogeneousAgent.sendPrompt', {
        operationId: input.operationId,
        prompt: 'Reply with exactly ' + input.marker + ' and nothing else. Do not use tools.',
        sessionId,
        topicId: input.topicId,
      });
      settlement = await Promise.race([
        sendPromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Timed out after ' + input.timeoutMs + 'ms')), input.timeoutMs);
        }),
      ]);
    } catch (error) {
      caughtError = errorValue(error);
      if (sessionId && sendPromise) {
        await invoke('heterogeneousAgent.cancelSession', { sessionId }).catch(() => {});
        await Promise.race([
          sendPromise.catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (sessionId) {
        ipc.removeListener('heteroAgentEvent', onEvent);
        ipc.removeListener('heteroAgentSessionComplete', onComplete);
        ipc.removeListener('heteroAgentSessionError', onError);
        await invoke('heterogeneousAgent.stopSession', { sessionId }).catch(() => {});
      }
    }

    const responseText = textChunks.join('');
    const markerObserved = responseText.includes(input.marker);
    const completed = terminal && terminal.kind === 'complete';
    const relayInvocation = settlement && settlement.relayInvocation || null;
    const relayVerified = Boolean(
      settlement && settlement.success === true &&
      relayInvocation &&
      typeof relayInvocation.acceptedAt === 'string' && relayInvocation.acceptedAt &&
      relayInvocation.agentType === input.agentType &&
      relayInvocation.ingress === input.ingress &&
      relayInvocation.model === input.model &&
      relayInvocation.operationId === input.operationId &&
      relayInvocation.provider === 'lobehub'
    );
    const ok = !caughtError && completed && markerObserved && relayVerified;
    const observedModels = [...new Set(events.map((event) => event.model).filter(Boolean))];
    const observedProviders = [...new Set(events.map((event) => event.provider).filter(Boolean))];
    record.result = {
      completed: Boolean(completed),
      durationMs: Date.now() - startedAt,
      error: caughtError || (terminal && terminal.kind === 'error' ? terminal.error : null),
      events,
      marker: input.marker,
      markerObserved,
      observedModels,
      observedProviders,
      ok,
      operationId: input.operationId,
      relayInvocation,
      relayVerified,
      responseText,
      sessionId,
      terminal,
    };
    record.state = 'done';
  })().catch((error) => {
    record.result = {
      completed: false,
      durationMs: null,
      error: { message: error instanceof Error ? error.message : String(error) },
      events: [],
      marker: input.marker,
      markerObserved: false,
      observedModels: [],
      observedProviders: [],
      ok: false,
      operationId: input.operationId,
      relayInvocation: null,
      relayVerified: false,
      responseText: '',
      sessionId: null,
      terminal: null,
    };
    record.state = 'done';
  });

  return JSON.stringify({ state: 'started' });
})(${JSON.stringify(input)})
`;

const buildCasePollScript = (operationId) => `
(function (operationId) {
  const runs = window[${JSON.stringify(CASE_RUNS_KEY)}];
  const record = runs && runs[operationId];
  if (!record) return JSON.stringify({ state: 'missing' });
  if (record.state !== 'done') return JSON.stringify({ state: record.state });
  const result = record.result;
  delete runs[operationId];
  return JSON.stringify({ result, state: 'done' });
})(${JSON.stringify(operationId)})
`;

const executeCell = async (options, preflight, cell) => {
  const operationId = randomUUID();
  const marker = `LOBEHUB_HETERO_SMOKE_OK_${operationId.slice(0, 8).toUpperCase()}`;
  const input = {
    agentType: cell.agentType,
    command: AGENTS[cell.agentType].command,
    cwd: options.cwd,
    env:
      cell.agentType === 'claude-code'
        ? { DISABLE_AUTOUPDATER: '1', DISABLE_UPDATES: '1' }
        : undefined,
    ingress: AGENTS[cell.agentType].ingress,
    marker,
    model: cell.model,
    operationId,
    timeoutMs: Math.round(options.timeoutSeconds * 1000),
    topicId: preflight.topicId,
  };
  const hostTimeout = input.timeoutMs + 20_000;
  try {
    const startRaw = await runAgentBrowserEval(options, buildCaseStartScript(input), 15_000);
    const start = parseAgentBrowserJson(startRaw);
    if (!['running', 'started'].includes(start.state)) {
      throw new Error(`renderer did not start the cell (state: ${start.state ?? 'unknown'})`);
    }

    const deadline = Date.now() + hostTimeout;
    let lastPollError;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      let poll;
      try {
        const pollRaw = await runAgentBrowserEval(
          options,
          buildCasePollScript(operationId),
          15_000,
        );
        poll = parseAgentBrowserJson(pollRaw);
        lastPollError = undefined;
      } catch (error) {
        lastPollError = error;
        continue;
      }
      if (poll.state === 'done') return poll.result;
      if (poll.state === 'missing') {
        throw new Error('renderer lost the in-page cell state before completion');
      }
      if (poll.state !== 'running') {
        throw new Error(`unexpected renderer cell state: ${poll.state ?? 'unknown'}`);
      }
    }
    throw new Error(
      lastPollError instanceof Error
        ? `cell polling timed out: ${lastPollError.message}`
        : `cell polling timed out after ${hostTimeout}ms`,
    );
  } catch (error) {
    return {
      completed: false,
      durationMs: null,
      error: { message: error instanceof Error ? error.message : String(error) },
      events: [],
      marker,
      markerObserved: false,
      observedModels: [],
      observedProviders: [],
      ownershipLost: true,
      ok: false,
      operationId,
      relayInvocation: null,
      relayVerified: false,
      responseText: '',
      sessionId: null,
      terminal: null,
    };
  }
};

const timestamp = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const reportDirectory = (options) =>
  options.reportDir ??
  path.join(
    process.cwd(),
    '.records',
    'reports',
    `${timestamp()}-heterogeneous-official-provider-smoke`,
  );

const stableCaseId = ({ agentType, model }) => {
  const modelSlug = model
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 48);
  const digest = createHash('sha256').update(`${agentType}\0${model}`).digest('hex').slice(0, 8);
  return `official-${agentType}-${modelSlug || 'model'}-${digest}`;
};

const errorMessage = (error) => {
  if (!error) return 'unknown failure';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string') return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const writeEvidence = (dir, caseId, evidence) => {
  const relative = path.join('assets', `${caseId}.txt`);
  writeFileSync(path.join(dir, relative), `${JSON.stringify(evidence, null, 2)}\n`);
  return relative;
};

const gitValue = (args, fallback = 'unknown') => {
  try {
    return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' }).trim() || fallback;
  } catch {
    return fallback;
  }
};

const buildPlan = (matrix) =>
  matrix.map((cell) => ({
    category: 'Official heterogeneous provider compatibility',
    expected: `The real ${AGENTS[cell.agentType].title} CLI completes against ${cell.model} and returns the per-run marker through LobeHub's official relay.`,
    id: stableCaseId(cell),
    method: `Launch ${AGENTS[cell.agentType].title} through Desktop's server-default binding, select ${cell.model}, and issue one marker-only prompt.`,
    requiredEvidence: ['text'],
    title: `${AGENTS[cell.agentType].title} × ${cell.model}`,
    verifier: 'program',
  }));

const writeReport = ({ cases, createdAt, dir, matrix, options, plan, preflight }) => {
  const passed = cases.filter((item) => item.status === 'pass').length;
  const failed = cases.filter((item) => item.status === 'fail').length;
  const blocked = cases.filter((item) => item.status === 'blocked').length;
  const pending = matrix.length - cases.length;
  const verdict = failed > 0 ? 'fail' : blocked > 0 || pending > 0 ? 'partial' : 'pass';
  const rows = cases.map((item) => ({
    agent: item.agent,
    cliVersion: item.cliVersion,
    durationMs: item.durationMs,
    model: item.model,
    status: item.status,
  }));
  const reportCases = cases.map((item, index) => ({
    ...item.case,
    ...(index === 0
      ? {
          datasets: [
            {
              fields: [
                { key: 'agent', type: 'category' },
                { key: 'model', type: 'string' },
                { key: 'cliVersion', type: 'string' },
                { key: 'status', type: 'category' },
                { key: 'durationMs', type: 'number' },
              ],
              id: 'official-provider-matrix',
              rows,
            },
          ],
          visualizations: [
            {
              dataset: 'official-provider-matrix',
              encoding: { columns: ['agent', 'model', 'cliVersion', 'status', 'durationMs'] },
              id: 'official-provider-matrix-table',
              title: 'Official provider compatibility matrix',
              type: 'table',
              version: 1,
            },
          ],
        }
      : {}),
  }));
  const conclusion = `${passed}/${matrix.length} cells passed, ${failed} failed, ${blocked} blocked${pending ? `, ${pending} pending` : ''}.`;
  const result = {
    branch: gitValue(['branch', '--show-current']),
    cases: reportCases,
    commit: gitValue(['rev-parse', '--short=12', 'HEAD']),
    createdAt,
    entry: `node .agents/skills/testing-heterogeneous-agents/scripts/official-smoke.mjs run --confirm-live --cdp ${options.cdp}`,
    plan,
    scenario: 'coding',
    subject: options.subject ?? null,
    summary: {
      blocked,
      conclusion,
      failed,
      passed,
      total: matrix.length,
      verdict,
    },
    surfaces: ['desktop'],
    title: 'LobeHub official heterogeneous provider compatibility matrix',
  };
  writeFileSync(path.join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);

  const server =
    preflight.remoteConfig?.storageMode === 'selfHost'
      ? (preflight.remoteConfig.remoteServerUrl ?? 'self-hosted server')
      : 'LobeHub Cloud';
  const report = `## 备注 / 说明

- Matrix source: the live \`getServerDefaultHeterogeneousCapability\` response from ${server}.
- Execution path: Electron renderer → Desktop IPC → server-default binding → real CLI → LobeHub official relay.
- The harness did not read custom provider credentials or invoke any installer/updater command.
- Claude Code runs set \`DISABLE_AUTOUPDATER=1\` and \`DISABLE_UPDATES=1\`.
- Server operation records and official-provider usage are expected side effects of live cells.
`;
  writeFileSync(path.join(dir, 'report.md'), report);
};

const runMatrix = async (options, preflight, matrix) => {
  if (!options.confirmLive) {
    fail(
      'run requires --confirm-live because it makes real official-provider requests and consumes usage',
      2,
    );
  }
  if (!preflight.topicId) {
    fail('run needs --topic-id or an active personal topic in the Electron window', 3);
  }

  const dir = reportDirectory(options);
  options.cwd ??= path.join(dir, 'workspace');
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  mkdirSync(options.cwd, { recursive: true });
  const plan = buildPlan(matrix);
  const createdAt = new Date().toISOString();
  const cases = [];
  writeReport({ cases, createdAt, dir, matrix, options, plan, preflight });

  for (const cell of matrix) {
    const caseId = stableCaseId(cell);
    const binary = preflight.binaries[cell.agentType];
    const common = {
      agent: AGENTS[cell.agentType].title,
      cliVersion: binary?.version ?? null,
      durationMs: null,
      model: cell.model,
    };

    if (!binary?.available) {
      const evidence = {
        agentType: cell.agentType,
        binary,
        model: cell.model,
        status: 'blocked',
      };
      const evidencePath = writeEvidence(dir, caseId, evidence);
      cases.push({
        ...common,
        case: {
          category: 'Official heterogeneous provider compatibility',
          evidence: [evidencePath],
          id: caseId,
          name: `${AGENTS[cell.agentType].title} × ${cell.model}`,
          observation: `${AGENTS[cell.agentType].title} is not installed or detectable; no installer or updater was invoked.`,
          status: 'blocked',
          surface: 'desktop',
        },
        status: 'blocked',
      });
      console.log(`BLOCKED ${cell.agentType} / ${cell.model}: CLI unavailable`);
      writeReport({ cases, createdAt, dir, matrix, options, plan, preflight });
      continue;
    }

    process.stdout.write(`RUN     ${cell.agentType} / ${cell.model} ... `);
    const evidence = await executeCell(options, preflight, cell);
    const status = evidence.ok ? 'pass' : 'fail';
    const evidencePath = writeEvidence(dir, caseId, {
      agentType: cell.agentType,
      cli: { path: binary.path ?? null, version: binary.version ?? null },
      model: cell.model,
      ...evidence,
    });
    const observation = evidence.ownershipLost
      ? `Matrix aborted after losing renderer ownership: ${errorMessage(evidence.error)}`
      : evidence.ok
        ? `Completed in ${evidence.durationMs}ms and returned the unique marker through the official relay.`
        : !evidence.relayVerified
          ? 'The CLI completed without authoritative proof that the selected model traversed the official relay.'
          : `Did not complete the marker round trip: ${errorMessage(evidence.error ?? evidence.terminal ?? 'marker missing')}`;
    cases.push({
      ...common,
      case: {
        category: 'Official heterogeneous provider compatibility',
        evidence: [evidencePath],
        id: caseId,
        name: `${AGENTS[cell.agentType].title} × ${cell.model}`,
        observation,
        status,
        surface: 'desktop',
      },
      durationMs: evidence.durationMs,
      status,
    });
    console.log(
      `${status.toUpperCase()}${evidence.durationMs ? ` (${evidence.durationMs}ms)` : ''}`,
    );
    writeReport({ cases, createdAt, dir, matrix, options, plan, preflight });
    if (evidence.ownershipLost) {
      console.error(`ABORTED matrix: ${errorMessage(evidence.error)}`);
      break;
    }
  }

  const failed = cases.filter((item) => item.status === 'fail').length;
  const blocked = cases.filter((item) => item.status === 'blocked').length;
  console.log(`Report: ${dir}`);
  console.log(
    `Result: ${cases.length - failed - blocked} passed, ${failed} failed, ${blocked} blocked`,
  );
  process.exitCode = failed > 0 ? 1 : blocked > 0 ? 2 : 0;
};

const { command, options } = parseArgs(process.argv.slice(2));
if (command === 'run' && !options.confirmLive) {
  fail(
    'run requires --confirm-live because it makes real official-provider requests and consumes usage',
    2,
  );
}
const preflight = await readPreflight(options).catch((error) => {
  fail(error instanceof Error ? error.message : String(error), 3);
});
const matrix = selectMatrix(preflight, options);

if (command === 'list') {
  printMatrix(preflight, matrix, options.json);
} else {
  await runMatrix(options, preflight, matrix);
}

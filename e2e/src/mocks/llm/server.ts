/**
 * Server-side LLM mock.
 *
 * Agent runs execute on the LobeHub server and stream to the browser over the
 * Agent Gateway, so the model call never passes through the page and a
 * browser-side interceptor cannot answer it. The E2E server is pointed at this
 * OpenAI-compatible endpoint instead (`DEEPSEEK_PROXY_URL`, the default
 * provider), and each test registers the replies it expects here.
 *
 * Cucumber runs scenarios in several worker processes against one app server,
 * so the endpoint is shared. It runs in its own detached process
 * (`./serve.mjs`, plain JavaScript started with bare `node`), launched by the
 * first worker that needs it, so no worker's exit can take it down while the
 * others are still running; every worker registers its replies over HTTP. The
 * process exits on its own once idle (`E2E_LLM_MOCK_IDLE_MS`).
 */
import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const LLM_MOCK_PORT = Number(process.env.E2E_LLM_MOCK_PORT || 3990);
export const LLM_MOCK_URL = `http://127.0.0.1:${LLM_MOCK_PORT}`;

export interface LLMMockReplyConfig {
  /** Delay before the first chunk, in ms */
  responseDelay: number;
  /** Characters per streamed chunk */
  streamChunkSize: number;
  /** Delay between chunks, in ms */
  streamDelay: number;
}

export interface LLMMockReply extends LLMMockReplyConfig {
  /** Lower-cased, trimmed user message (exact) or fragment (contains) */
  key: string;
  match: 'contains' | 'exact';
  response: string;
}

/** This Cucumber worker; registrations and clears are scoped to it. */
const WORKER_ID = process.env.CUCUMBER_WORKER_ID ?? '0';

const SERVE_SCRIPT = path.join(__dirname, 'serve.mjs');
const LOG_FILE = path.join(tmpdir(), `lobehub-e2e-llm-mock-${LLM_MOCK_PORT}.log`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isServing = async () => {
  try {
    return (await fetch(`${LLM_MOCK_URL}/__e2e/health`)).ok;
  } catch {
    return false;
  }
};

const spawnMockProcess = () => {
  const log = openSync(LOG_FILE, 'a');
  try {
    const child = spawn(process.execPath, [SERVE_SCRIPT], {
      detached: true,
      env: { ...process.env, E2E_LLM_MOCK_PORT: String(LLM_MOCK_PORT) },
      stdio: ['ignore', log, log],
    });
    child.unref();
  } finally {
    closeSync(log);
  }
};

const readLog = () => {
  try {
    return readFileSync(LOG_FILE, 'utf8').slice(-2000);
  } catch {
    return '';
  }
};

let starting: Promise<void> | undefined;

/**
 * Make sure the shared endpoint is up, starting its process when nobody
 * serves the port yet. Safe to call from every worker: concurrent starters
 * race for the port and the losers exit. Only an in-flight start is shared;
 * every later call checks again, because the process exits once idle.
 */
export const ensureLLMMockServer = (): Promise<void> => {
  starting ??= (async () => {
    if (await isServing()) return;
    spawnMockProcess();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await isServing()) {
        console.log(`   ✓ LLM mock endpoint listening on ${LLM_MOCK_URL}`);
        return;
      }
      await sleep(100);
    }
    throw new Error(
      `LLM mock endpoint did not start on ${LLM_MOCK_URL}. Log (${LOG_FILE}):\n${readLog()}`,
    );
  })().finally(() => {
    starting = undefined;
  });
  return starting;
};

/** Send replies (and the default) to the shared endpoint. */
export const registerLLMReplies = async (payload: {
  clear?: string[];
  defaultReply?: LLMMockReplyConfig & { response: string };
  replies?: LLMMockReply[];
}) => {
  await ensureLLMMockServer();
  const res = await fetch(`${LLM_MOCK_URL}/__e2e/llm/replies`, {
    body: JSON.stringify({ ...payload, owner: WORKER_ID }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!res.ok) throw new Error(`LLM mock registration failed: ${res.status}`);
};

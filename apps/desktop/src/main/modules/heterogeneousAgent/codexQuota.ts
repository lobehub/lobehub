import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { resolveCliSpawnPlan } from '@lobechat/heterogeneous-agents/spawn';

const RPC_TIMEOUT_MS = 10_000;
const RESET_CREDITS_TIMEOUT_MS = 1_500;
const CODEX_RATE_LIMIT_RESET_CREDITS_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';

export interface CodexQuotaWindow {
  resetsAt: number | null;
  usedPercent: number;
  windowMinutes: number;
}

export interface CodexRateLimitResetCredits {
  availableCount: number;
  credits?: {
    expiresAt: number | null;
    grantedAt: number | null;
    status: string;
  }[];
  nextExpiresAt?: number | null;
  totalEarnedCount?: number;
}

export interface CodexQuotaSnapshot {
  error: string | null;
  provider: 'codex';
  rateLimitResetCredits?: CodexRateLimitResetCredits | null;
  session: CodexQuotaWindow | null;
  status: 'error' | 'ok' | 'unavailable';
  updatedAt: number;
  weekly: CodexQuotaWindow | null;
}

export interface FetchCodexQuotaOptions {
  codexHomePath?: string | null;
  command?: string;
  env?: NodeJS.ProcessEnv;
}

interface RpcResponse {
  error?: { message?: string };
  id?: number;
  result?: unknown;
}

interface RpcRateWindow {
  resetsAt?: number;
  usedPercent?: number;
  windowDurationMins?: number;
}

interface RpcRateLimitsResponse {
  rateLimitResetCredits?: {
    availableCount?: number;
    credits?: {
      expiresAt?: number | string | null;
      grantedAt?: number | string | null;
      status?: string;
    }[];
    nextExpiresAt?: number | string | null;
    totalEarnedCount?: number;
  } | null;
  rateLimits?: {
    primary?: RpcRateWindow;
    secondary?: RpcRateWindow;
  };
}

interface CodexAuthFile {
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
}

interface BackendRateLimitResetCreditsResponse {
  available_count?: number;
  credits?: {
    expires_at?: number | string | null;
    granted_at?: number | string | null;
    status?: string;
  }[];
  total_earned_count?: number;
}

interface CodexBackendAuth {
  headers: Record<string, string>;
}

const getCodexHomePath = ({ codexHomePath, env }: FetchCodexQuotaOptions) =>
  codexHomePath ?? env?.CODEX_HOME ?? process.env.CODEX_HOME ?? path.join(homedir(), '.codex');

const errorSnapshot = (message: string): CodexQuotaSnapshot => ({
  error: message,
  provider: 'codex',
  session: null,
  status: 'error',
  updatedAt: Date.now(),
  weekly: null,
});

const buildRpcMessage = (id: number, method: string, params: unknown = {}) =>
  `${JSON.stringify({ id, jsonrpc: '2.0', method, params })}\n`;

const parseCreditTimestamp = (value: number | string | null | undefined): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }

  if (typeof value !== 'string' || !value.trim()) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeCreditStatus = (status?: string) => status?.toLowerCase() ?? 'unknown';

const getNextAvailableCreditExpiry = (
  credits: CodexRateLimitResetCredits['credits'] | undefined,
) =>
  credits
    ?.filter((credit) => credit.status === 'available' && typeof credit.expiresAt === 'number')
    .map((credit) => credit.expiresAt as number)
    .sort((a, b) => a - b)[0] ?? null;

const mapRpcResetCredits = (
  raw: RpcRateLimitsResponse['rateLimitResetCredits'],
): CodexRateLimitResetCredits | null | undefined => {
  if (raw === null) return null;
  if (raw === undefined) return undefined;
  if (typeof raw.availableCount !== 'number' || !Number.isFinite(raw.availableCount)) return null;

  const credits = raw.credits?.map((credit) => ({
    expiresAt: parseCreditTimestamp(credit.expiresAt),
    grantedAt: parseCreditTimestamp(credit.grantedAt),
    status: normalizeCreditStatus(credit.status),
  }));

  return {
    availableCount: Math.max(0, Math.floor(raw.availableCount)),
    ...(credits ? { credits } : {}),
    nextExpiresAt: parseCreditTimestamp(raw.nextExpiresAt) ?? getNextAvailableCreditExpiry(credits),
    ...(typeof raw.totalEarnedCount === 'number' && Number.isFinite(raw.totalEarnedCount)
      ? { totalEarnedCount: Math.max(0, Math.floor(raw.totalEarnedCount)) }
      : {}),
  };
};

const mapBackendResetCredits = (
  raw: BackendRateLimitResetCreditsResponse | null | undefined,
): CodexRateLimitResetCredits | null => {
  if (!raw) return null;

  const credits = raw.credits?.map((credit) => ({
    expiresAt: parseCreditTimestamp(credit.expires_at),
    grantedAt: parseCreditTimestamp(credit.granted_at),
    status: normalizeCreditStatus(credit.status),
  }));
  const availableCount =
    typeof raw.available_count === 'number' && Number.isFinite(raw.available_count)
      ? raw.available_count
      : (credits?.filter((credit) => credit.status === 'available').length ?? null);

  if (availableCount === null) return null;

  return {
    availableCount: Math.max(0, Math.floor(availableCount)),
    ...(credits ? { credits } : {}),
    nextExpiresAt: getNextAvailableCreditExpiry(credits),
    ...(typeof raw.total_earned_count === 'number' && Number.isFinite(raw.total_earned_count)
      ? { totalEarnedCount: Math.max(0, Math.floor(raw.total_earned_count)) }
      : {}),
  };
};

const readCodexBackendAuth = async (
  options: FetchCodexQuotaOptions,
): Promise<CodexBackendAuth | null> => {
  let auth: CodexAuthFile;

  try {
    const authPath = path.join(getCodexHomePath(options), 'auth.json');
    auth = JSON.parse(await readFile(authPath, 'utf8')) as CodexAuthFile;
  } catch {
    return null;
  }

  const accessToken = auth.tokens?.access_token;
  if (!accessToken) return null;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'OpenAI-Beta': 'codex-1',
    'User-Agent': 'codex-cli',
    originator: 'LobeHub Desktop',
  };

  if (auth.tokens?.account_id) {
    headers['ChatGPT-Account-Id'] = auth.tokens.account_id;
  }

  return { headers };
};

const fetchBackendResetCredits = async (
  auth: CodexBackendAuth,
): Promise<CodexRateLimitResetCredits | null> => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, RESET_CREDITS_TIMEOUT_MS);
  });

  const fetchPromise = (async () => {
    const response = await fetch(CODEX_RATE_LIMIT_RESET_CREDITS_URL, {
      ...auth,
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as BackendRateLimitResetCreditsResponse;
    return mapBackendResetCredits(payload);
  })();

  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const mapRpcWindow = (
  raw: RpcRateWindow | undefined,
  fallbackWindowMinutes: number,
): CodexQuotaWindow | null => {
  if (!raw || typeof raw.usedPercent !== 'number' || !Number.isFinite(raw.usedPercent)) {
    return null;
  }

  const windowMinutes =
    typeof raw.windowDurationMins === 'number' &&
    Number.isFinite(raw.windowDurationMins) &&
    raw.windowDurationMins > 0
      ? Math.floor(raw.windowDurationMins)
      : fallbackWindowMinutes;

  return {
    resetsAt:
      typeof raw.resetsAt === 'number' && Number.isFinite(raw.resetsAt)
        ? raw.resetsAt * 1000
        : null,
    usedPercent: Math.min(100, Math.max(0, raw.usedPercent)),
    windowMinutes,
  };
};

const cleanupRpcListeners = (
  child: ChildProcess,
  listeners: {
    close: () => void;
    error: (error: Error) => void;
    stderrData: (chunk: Buffer) => void;
    stdoutData: (chunk: Buffer) => void;
  },
) => {
  child.stdout?.off('data', listeners.stdoutData);
  child.stderr?.off('data', listeners.stderrData);
  child.off('error', listeners.error);
  child.off('close', listeners.close);
};

const fetchViaRpc = async (
  options: FetchCodexQuotaOptions,
  auth: CodexBackendAuth | null,
): Promise<CodexQuotaSnapshot> =>
  new Promise<CodexQuotaSnapshot>((resolve) => {
    let buffer = '';
    let child: ChildProcess | null = null;
    let initId = 0;
    let stderr = '';
    let resolved = false;
    let rpcId = 0;
    let rateLimitsId: number | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const rpcArgs = ['-s', 'read-only', '-a', 'untrusted', 'app-server'];

    const settle = (result: CodexQuotaSnapshot, kill = false) => {
      if (resolved) return;
      resolved = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      if (child) {
        cleanupRpcListeners(child, listeners);
        if (kill) child.kill();
      }
      resolve(result);
    };

    const sendRpc = (child: ChildProcess, method: string, params?: unknown) => {
      const id = ++rpcId;
      child.stdin?.write(buildRpcMessage(id, method, params));
      return id;
    };

    const sendNotification = (child: ChildProcess, method: string) => {
      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: {} })}\n`);
    };

    const handleRateLimitsResponse = async (message: RpcResponse) => {
      if (message.error) {
        settle(errorSnapshot(message.error.message ?? 'Codex rate-limit RPC failed'), true);
        return;
      }

      const wrapper = message.result as RpcRateLimitsResponse | undefined;
      const rateLimitResetCredits = mapRpcResetCredits(wrapper?.rateLimitResetCredits);
      let backendCredits: CodexRateLimitResetCredits | null = null;

      if (auth && rateLimitResetCredits?.nextExpiresAt == null) {
        try {
          backendCredits = await fetchBackendResetCredits(auth);
        } catch {
          backendCredits = null;
        }
      }

      settle(
        {
          error: null,
          provider: 'codex',
          rateLimitResetCredits:
            backendCredits ??
            (rateLimitResetCredits === undefined ? undefined : rateLimitResetCredits),
          session: mapRpcWindow(wrapper?.rateLimits?.primary, 300),
          status: 'ok',
          updatedAt: Date.now(),
          weekly: mapRpcWindow(wrapper?.rateLimits?.secondary, 10_080),
        },
        true,
      );
    };

    const onStdoutData = (child: ChildProcess) => (chunk: Buffer) => {
      buffer += chunk.toString();

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;

        try {
          const message = JSON.parse(line) as RpcResponse;
          if (message.id === initId) {
            if (!child) return;
            sendNotification(child, 'initialized');
            rateLimitsId = sendRpc(child, 'account/rateLimits/read');
            continue;
          }

          if (rateLimitsId !== null && message.id === rateLimitsId) {
            void handleRateLimitsResponse(message);
          }
        } catch {
          // Ignore non-JSON output from the RPC process.
        }
      }
    };

    const onStderrData = (chunk: Buffer) => {
      stderr += chunk.toString();
    };

    const listeners = {
      close: () => settle(errorSnapshot(stderr || 'Codex rate-limit RPC exited'), false),
      error: (error: Error) => settle(errorSnapshot(error.message), false),
      stderrData: onStderrData,
      stdoutData: (chunk: Buffer) => {
        if (child) onStdoutData(child)(chunk);
      },
    };

    timeout = setTimeout(() => {
      settle(errorSnapshot('Codex rate-limit RPC timed out'), true);
    }, RPC_TIMEOUT_MS);

    void resolveCliSpawnPlan(options.command ?? 'codex', rpcArgs)
      .then((spawnPlan) => {
        if (resolved) return;

        child = spawn(spawnPlan.command, spawnPlan.args, {
          env: {
            ...process.env,
            ...options.env,
            ...(options.codexHomePath ? { CODEX_HOME: options.codexHomePath } : {}),
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        child.stdout?.on('data', listeners.stdoutData);
        child.stderr?.on('data', listeners.stderrData);
        child.on('error', listeners.error);
        child.on('close', listeners.close);
        initId = sendRpc(child, 'initialize', {
          clientInfo: { name: 'lobehub', version: '1.0.0' },
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to resolve Codex command';
        settle(errorSnapshot(message), true);
      });
  });

export const fetchCodexQuota = async (
  options: FetchCodexQuotaOptions = {},
): Promise<CodexQuotaSnapshot> => {
  const auth = await readCodexBackendAuth(options);
  return fetchViaRpc(options, auth);
};

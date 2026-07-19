import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import type {
  CodexQuotaSnapshot,
  CodexQuotaWindow,
  CodexRateLimitResetCredit,
  CodexRateLimitResetCredits,
  CodexRateLimitResetOutcome,
  CodexRateLimitSnapshot,
} from '@lobechat/electron-client-ipc';
import { resolveCliSpawnPlan } from '@lobechat/heterogeneous-agents/spawn';

const RPC_TIMEOUT_MS = 10_000;
const CODEX_PRIMARY_WINDOW_MINUTES = 5 * 60;
const CODEX_SECONDARY_WINDOW_MINUTES = 7 * 24 * 60;
const RESET_CONSUME_TIMEOUT_MS = 30_000;
const RESET_CREDITS_TIMEOUT_MS = 5_000;
const CODEX_RATE_LIMIT_RESET_CREDITS_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const CODEX_RATE_LIMIT_RESET_CONSUME_URL = `${CODEX_RATE_LIMIT_RESET_CREDITS_URL}/consume`;

export interface FetchCodexQuotaOptions {
  codexHomePath?: string | null;
  command?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ConsumeCodexRateLimitResetCreditOptions extends FetchCodexQuotaOptions {
  creditId?: string;
  idempotencyKey: string;
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

interface RpcRateLimitSnapshot {
  limitId?: string | null;
  limitName?: string | null;
  primary?: RpcRateWindow;
  secondary?: RpcRateWindow;
}

interface RpcRateLimitResetCredit {
  expiresAt?: number | string | null;
  grantedAt?: number | string | null;
  id?: string;
  redeemedAt?: number | string | null;
  redeemStartedAt?: number | string | null;
  resetType?: string;
  status?: string;
  title?: string | null;
}

interface RpcRateLimitsResponse {
  rateLimitResetCredits?: {
    availableCount?: number;
    credits?: RpcRateLimitResetCredit[] | null;
    nextExpiresAt?: number | string | null;
    totalEarnedCount?: number;
  } | null;
  rateLimits?: RpcRateLimitSnapshot;
  rateLimitsByLimitId?: Record<string, RpcRateLimitSnapshot> | null;
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
    id?: string;
    redeem_started_at?: number | string | null;
    redeemed_at?: number | string | null;
    reset_type?: string;
    status?: string;
    title?: string | null;
  }[];
  total_earned_count?: number;
}

interface BackendConsumeRateLimitResetCreditResponse {
  code?: string;
}

interface RpcConsumeRateLimitResetCreditResponse {
  outcome?: string;
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

const normalizeCreditText = (value: string | null | undefined) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const mapRpcResetCredit = (credit: RpcRateLimitResetCredit): CodexRateLimitResetCredit => ({
  expiresAt: parseCreditTimestamp(credit.expiresAt),
  grantedAt: parseCreditTimestamp(credit.grantedAt),
  id: normalizeCreditText(credit.id),
  redeemStartedAt: parseCreditTimestamp(credit.redeemStartedAt),
  redeemedAt: parseCreditTimestamp(credit.redeemedAt),
  resetType: normalizeCreditText(credit.resetType),
  status: normalizeCreditStatus(credit.status),
  title: normalizeCreditText(credit.title),
});

const mapBackendResetCredit = (
  credit: NonNullable<BackendRateLimitResetCreditsResponse['credits']>[number],
): CodexRateLimitResetCredit => ({
  expiresAt: parseCreditTimestamp(credit.expires_at),
  grantedAt: parseCreditTimestamp(credit.granted_at),
  id: normalizeCreditText(credit.id),
  redeemStartedAt: parseCreditTimestamp(credit.redeem_started_at),
  redeemedAt: parseCreditTimestamp(credit.redeemed_at),
  resetType: normalizeCreditText(credit.reset_type),
  status: normalizeCreditStatus(credit.status),
  title: normalizeCreditText(credit.title),
});

const getNextAvailableCreditExpiry = (
  credits: CodexRateLimitResetCredits['credits'] | undefined,
  now = Date.now(),
) =>
  credits
    ?.filter(
      (credit) =>
        credit.status === 'available' &&
        typeof credit.expiresAt === 'number' &&
        credit.expiresAt > now,
    )
    .map((credit) => credit.expiresAt as number)
    .sort((a, b) => a - b)[0] ?? null;

const mapRpcResetCredits = (
  raw: RpcRateLimitsResponse['rateLimitResetCredits'],
): CodexRateLimitResetCredits | null | undefined => {
  if (raw === null) return null;
  if (raw === undefined) return undefined;
  if (typeof raw.availableCount !== 'number' || !Number.isFinite(raw.availableCount)) return null;

  const credits = Array.isArray(raw.credits) ? raw.credits.map(mapRpcResetCredit) : undefined;

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

  const credits = raw.credits?.map(mapBackendResetCredit);
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
    'Authorization': `Bearer ${accessToken}`,
    'OpenAI-Beta': 'codex-1',
    'User-Agent': 'codex-cli',
    'originator': 'LobeHub Desktop',
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

const mapConsumeOutcome = (outcome: string | undefined): CodexRateLimitResetOutcome => {
  switch (outcome) {
    case 'already_redeemed':
    case 'alreadyRedeemed': {
      return 'alreadyRedeemed';
    }
    case 'no_credit':
    case 'noCredit': {
      return 'noCredit';
    }
    case 'nothing_to_reset':
    case 'nothingToReset': {
      return 'nothingToReset';
    }
    case 'reset': {
      return 'reset';
    }
    default: {
      throw new Error(`Unknown Codex rate-limit reset outcome: ${outcome ?? 'missing'}`);
    }
  }
};

const consumeBackendResetCredit = async (
  auth: CodexBackendAuth,
  options: ConsumeCodexRateLimitResetCreditOptions,
): Promise<CodexRateLimitResetOutcome> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESET_CONSUME_TIMEOUT_MS);

  try {
    const response = await fetch(CODEX_RATE_LIMIT_RESET_CONSUME_URL, {
      body: JSON.stringify({
        ...(options.creditId ? { credit_id: options.creditId } : {}),
        redeem_request_id: options.idempotencyKey,
      }),
      headers: {
        ...auth.headers,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Codex rate-limit reset failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as BackendConsumeRateLimitResetCreditResponse;
    return mapConsumeOutcome(payload.code);
  } finally {
    clearTimeout(timeout);
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
    resetsAt: parseCreditTimestamp(raw.resetsAt),
    usedPercent: Math.min(100, Math.max(0, raw.usedPercent)),
    windowMinutes,
  };
};

const mapRpcRateLimitSnapshot = (
  raw: RpcRateLimitSnapshot | undefined,
  fallbackLimitId: string,
): CodexRateLimitSnapshot | null => {
  if (!raw) return null;

  const primary = mapRpcWindow(raw.primary, CODEX_PRIMARY_WINDOW_MINUTES);
  const secondary = mapRpcWindow(raw.secondary, CODEX_SECONDARY_WINDOW_MINUTES);
  if (!primary && !secondary) return null;

  return {
    limitId: normalizeCreditText(raw.limitId) ?? fallbackLimitId,
    limitName: normalizeCreditText(raw.limitName),
    primary,
    secondary,
  };
};

const mapRpcRateLimits = (wrapper: RpcRateLimitsResponse): CodexRateLimitSnapshot[] => {
  const snapshots = new Map<string, CodexRateLimitSnapshot>();

  const addSnapshot = (raw: RpcRateLimitSnapshot | undefined, fallbackLimitId: string) => {
    const snapshot = mapRpcRateLimitSnapshot(raw, fallbackLimitId);
    if (!snapshot) return;

    const normalizedId = snapshot.limitId.toLowerCase();
    if (!snapshots.has(normalizedId)) snapshots.set(normalizedId, snapshot);
  };

  addSnapshot(wrapper.rateLimits, 'codex');

  const additionalLimits = Object.entries(wrapper.rateLimitsByLimitId ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  for (const [limitId, snapshot] of additionalLimits) addSnapshot(snapshot, limitId);

  return [...snapshots.values()];
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

interface RpcRequestConfig {
  failureMessage: string;
  method: string;
  params?: unknown;
  timeoutMs?: number;
}

const requestViaRpc = async <T>(
  options: FetchCodexQuotaOptions,
  { failureMessage, method, params, timeoutMs = RPC_TIMEOUT_MS }: RpcRequestConfig,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let buffer = '';
    let child: ChildProcess | null = null;
    let initId: number | null = null;
    let stderr = '';
    let finished = false;
    let requestId: number | null = null;
    let rpcId = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const rpcArgs = ['-s', 'read-only', '-a', 'untrusted', 'app-server'];

    const cleanup = (kill: boolean) => {
      if (finished) return false;
      finished = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      if (child) {
        cleanupRpcListeners(child, listeners);
        if (kill) child.kill();
      }
      return true;
    };

    const settleError = (error: Error, kill = false) => {
      if (!cleanup(kill)) return;
      reject(error);
    };

    const settleResult = (result: T) => {
      if (!cleanup(true)) return;
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

    const onStdoutData = (chunk: Buffer) => {
      buffer += chunk.toString();

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;

        try {
          const message = JSON.parse(line) as RpcResponse;
          if (message.id === initId) {
            if (message.error) {
              settleError(
                new Error(message.error.message ?? `${failureMessage}: initialize`),
                true,
              );
              return;
            }
            if (!child) return;
            sendNotification(child, 'initialized');
            requestId = sendRpc(child, method, params);
            continue;
          }

          if (requestId !== null && message.id === requestId) {
            if (message.error) {
              settleError(new Error(message.error.message ?? failureMessage), true);
              return;
            }
            settleResult(message.result as T);
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
      close: () => settleError(new Error(stderr.trim() || `${failureMessage}: RPC exited`), false),
      error: (error: Error) => settleError(error, false),
      stderrData: onStderrData,
      stdoutData: onStdoutData,
    };

    timeout = setTimeout(() => {
      settleError(new Error(`${failureMessage}: RPC timed out`), true);
    }, timeoutMs);

    void resolveCliSpawnPlan(options.command ?? 'codex', rpcArgs)
      .then((spawnPlan) => {
        if (finished) return;

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
        settleError(new Error(message), true);
      });
  });

const fetchViaRpc = async (
  options: FetchCodexQuotaOptions,
  auth: CodexBackendAuth | null,
): Promise<CodexQuotaSnapshot> => {
  try {
    const wrapper = await requestViaRpc<RpcRateLimitsResponse>(options, {
      failureMessage: 'Codex rate-limit request failed',
      method: 'account/rateLimits/read',
    });
    const rateLimits = mapRpcRateLimits(wrapper);
    const defaultRateLimit =
      rateLimits.find(({ limitId }) => limitId.toLowerCase() === 'codex') ?? rateLimits[0];
    const rateLimitResetCredits = mapRpcResetCredits(wrapper?.rateLimitResetCredits);
    let backendCredits: CodexRateLimitResetCredits | null = null;

    // Older Codex app-server versions expose only availableCount. Use the same
    // backend contract as Codex/CodexBar to fill the detail rows when needed.
    if (auth && rateLimitResetCredits?.credits === undefined) {
      try {
        backendCredits = await fetchBackendResetCredits(auth);
      } catch {
        backendCredits = null;
      }
    }

    return {
      error: null,
      provider: 'codex',
      rateLimitResetCredits:
        backendCredits ?? (rateLimitResetCredits === undefined ? undefined : rateLimitResetCredits),
      rateLimits,
      session: defaultRateLimit?.primary ?? null,
      status: 'ok',
      updatedAt: Date.now(),
      weekly: defaultRateLimit?.secondary ?? null,
    };
  } catch (error) {
    return errorSnapshot(
      error instanceof Error ? error.message : 'Codex rate-limit request failed',
    );
  }
};

export const fetchCodexQuota = async (
  options: FetchCodexQuotaOptions = {},
): Promise<CodexQuotaSnapshot> => {
  const auth = await readCodexBackendAuth(options);
  return fetchViaRpc(options, auth);
};

export const consumeCodexRateLimitResetCredit = async (
  options: ConsumeCodexRateLimitResetCreditOptions,
): Promise<CodexRateLimitResetOutcome> => {
  const idempotencyKey = options.idempotencyKey.trim();
  const creditId = options.creditId?.trim();
  if (!idempotencyKey) throw new Error('Codex reset idempotency key is required');
  if (options.creditId !== undefined && !creditId) {
    throw new Error('Codex reset credit ID must not be empty');
  }

  const normalizedOptions = { ...options, creditId, idempotencyKey };
  const auth = await readCodexBackendAuth(normalizedOptions);

  try {
    const response = await requestViaRpc<RpcConsumeRateLimitResetCreditResponse>(
      normalizedOptions,
      {
        failureMessage: 'Codex rate-limit reset failed',
        method: 'account/rateLimitResetCredit/consume',
        params: {
          ...(creditId ? { creditId } : {}),
          idempotencyKey,
        },
        timeoutMs: RESET_CONSUME_TIMEOUT_MS,
      },
    );
    return mapConsumeOutcome(response?.outcome);
  } catch (rpcError) {
    // The reset endpoint predates the app-server consume method. Reuse the same
    // idempotency key so falling back is safe even if the RPC response was lost.
    if (!auth) throw rpcError;
    return consumeBackendResetCredit(auth, normalizedOptions);
  }
};

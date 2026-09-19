import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import type {
  CodexQuotaSnapshot,
  CodexRateLimitSnapshot,
  HeteroQuotaWindow,
} from '@lobechat/heterogeneous-agents/quota';
import {
  createQuotaCacheKey,
  QuotaSnapshotCache,
} from '@lobechat/heterogeneous-agents/quota-sampler';
import { buildCodexAppServerArgs, resolveCliSpawnPlan } from '@lobechat/heterogeneous-agents/spawn';

const RPC_TIMEOUT_MS = 10_000;
const CODEX_PRIMARY_WINDOW_MINUTES = 5 * 60;
const CODEX_SECONDARY_WINDOW_MINUTES = 7 * 24 * 60;

export interface GetCodexQuotaParams {
  command?: string;
  env?: Record<string, string>;
  force?: boolean;
}

interface RpcMessage {
  error?: { message?: string };
  id?: number;
  result?: unknown;
}

interface RpcWindow {
  resetsAt?: number;
  usedPercent?: number;
  windowDurationMins?: number;
}

interface RpcRateLimit {
  limitId?: string | null;
  limitName?: string | null;
  primary?: RpcWindow;
  secondary?: RpcWindow;
}

interface RpcRateLimitsResponse {
  rateLimits?: RpcRateLimit;
  rateLimitsByLimitId?: Record<string, RpcRateLimit> | null;
}

const quotaCache = new QuotaSnapshotCache<CodexQuotaSnapshot>();

const parseTimestamp = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value < 10_000_000_000 ? value * 1000 : value;
};

const mapWindow = (
  window: RpcWindow | undefined,
  fallbackWindowMinutes: number,
): HeteroQuotaWindow | null => {
  if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) {
    return null;
  }

  const windowMinutes =
    typeof window.windowDurationMins === 'number' &&
    Number.isFinite(window.windowDurationMins) &&
    window.windowDurationMins > 0
      ? Math.floor(window.windowDurationMins)
      : fallbackWindowMinutes;

  return {
    resetsAt: parseTimestamp(window.resetsAt),
    usedPercent: Math.min(100, Math.max(0, window.usedPercent)),
    windowMinutes,
  };
};

const mapRateLimit = (
  rateLimit: RpcRateLimit | undefined,
  fallbackId: string,
): CodexRateLimitSnapshot | null => {
  if (!rateLimit) return null;
  const primary = mapWindow(rateLimit.primary, CODEX_PRIMARY_WINDOW_MINUTES);
  const secondary = mapWindow(rateLimit.secondary, CODEX_SECONDARY_WINDOW_MINUTES);
  if (!primary && !secondary) return null;

  return {
    limitId: rateLimit.limitId?.trim() || fallbackId,
    limitName: rateLimit.limitName?.trim() || null,
    primary,
    secondary,
  };
};

const requestRateLimits = async (options: GetCodexQuotaParams): Promise<RpcRateLimitsResponse> =>
  new Promise((resolve, reject) => {
    let buffer = '';
    let child: ChildProcess | undefined;
    let initId: number | undefined;
    let requestId: number | undefined;
    let rpcId = 0;
    let stderr = '';
    let settled = false;

    const cleanup = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timeout);
      child?.kill();
      return true;
    };
    const fail = (error: Error) => {
      if (cleanup()) reject(error);
    };
    const send = (method: string, params: unknown = {}) => {
      const id = ++rpcId;
      child?.stdin?.write(`${JSON.stringify({ id, jsonrpc: '2.0', method, params })}\n`);
      return id;
    };
    const timeout = setTimeout(
      () => fail(new Error('Codex rate-limit request timed out')),
      RPC_TIMEOUT_MS,
    );

    void resolveCliSpawnPlan(options.command ?? 'codex', buildCodexAppServerArgs())
      .then((plan) => {
        if (settled) return;
        child = spawn(plan.command, plan.args, {
          env: { ...process.env, ...options.env },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on('error', fail);
        child.on('close', () => fail(new Error(stderr.trim() || 'Codex app-server exited')));
        child.stdout?.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (!line) continue;
            try {
              const message = JSON.parse(line) as RpcMessage;
              if (message.id === initId) {
                if (message.error)
                  return fail(new Error(message.error.message || 'Codex initialize failed'));
                child?.stdin?.write(
                  `${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`,
                );
                requestId = send('account/rateLimits/read');
              } else if (message.id === requestId) {
                if (message.error)
                  return fail(new Error(message.error.message || 'Codex quota failed'));
                if (cleanup()) resolve((message.result ?? {}) as RpcRateLimitsResponse);
              }
            } catch {
              // Codex can write non-JSON diagnostics to stdout; ignore those lines.
            }
          }
        });
        initId = send('initialize', { clientInfo: { name: 'lobehub', version: '1.0.0' } });
      })
      .catch((error: unknown) =>
        fail(error instanceof Error ? error : new Error('Failed to resolve Codex command')),
      );
  });

const fetchCodexQuota = async (options: GetCodexQuotaParams): Promise<CodexQuotaSnapshot> => {
  try {
    const response = await requestRateLimits(options);
    const snapshots = new Map<string, CodexRateLimitSnapshot>();
    const addSnapshot = (limit: RpcRateLimit | undefined, fallbackId: string) => {
      const snapshot = mapRateLimit(limit, fallbackId);
      if (!snapshot) return;
      const key = snapshot.limitId.toLowerCase();
      if (!snapshots.has(key)) snapshots.set(key, snapshot);
    };

    addSnapshot(response.rateLimits, 'codex');
    for (const [id, limit] of Object.entries(response.rateLimitsByLimitId ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      addSnapshot(limit, id);
    }
    const deduped = [...snapshots.values()];
    const primary = deduped.find((limit) => limit.limitId.toLowerCase() === 'codex') ?? deduped[0];

    return {
      error: null,
      provider: 'codex',
      rateLimits: deduped,
      session: primary?.primary ?? null,
      status: 'ok',
      updatedAt: Date.now(),
      weekly: primary?.secondary ?? null,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Codex rate-limit request failed',
      provider: 'codex',
      session: null,
      status: 'error',
      updatedAt: Date.now(),
      weekly: null,
    };
  }
};

export const getCodexQuota = (params: GetCodexQuotaParams = {}): Promise<CodexQuotaSnapshot> =>
  quotaCache.get(
    createQuotaCacheKey('codex', params.command, params.env),
    () => fetchCodexQuota(params),
    { force: params.force },
  );

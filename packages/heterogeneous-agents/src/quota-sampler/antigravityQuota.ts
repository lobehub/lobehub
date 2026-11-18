import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { isRecord, pickString } from '@lobechat/utils/object';

import { isHeterogeneousAgentAuthRequired } from '../config';
import type {
  AntigravityQuotaErrorCode,
  AntigravityQuotaGroup,
  AntigravityQuotaParams,
  AntigravityQuotaSnapshot,
} from '../quota/antigravity';
import { resolveCliSpawnPlan } from '../spawn/cliSpawn';
import { resolveHeteroSpawnCommand } from '../spawn/resolveCliCommand';

const execFilePromise = promisify(execFile);

const nonnegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** The native command envelope is distinct from a model response. Fail closed on older CLIs. */
export const parseAntigravityQuota = (payload: unknown): AntigravityQuotaGroup[] => {
  if (
    !isRecord(payload) ||
    payload.status !== 'SUCCESS' ||
    !isRecord(payload.command) ||
    payload.command.name !== 'usage' ||
    !isRecord(payload.command.data) ||
    !Array.isArray(payload.command.data.groups)
  ) {
    throw new Error('Antigravity did not return a structured usage command result');
  }

  return payload.command.data.groups.flatMap((group) => {
    if (!isRecord(group) || !pickString(group.name) || !Array.isArray(group.buckets)) return [];
    const seen = new Set<string>();
    const buckets = group.buckets.flatMap((bucket) => {
      if (!isRecord(bucket)) return [];
      const id = pickString(bucket.id);
      if (!id || seen.has(id)) return [];
      seen.add(id);
      const fraction = nonnegative(bucket.remaining_fraction);
      const reset = typeof bucket.reset_time === 'string' ? Date.parse(bucket.reset_time) : NaN;
      return [
        {
          disabled: bucket.disabled === true,
          id,
          name: pickString(bucket.name) ?? id,
          remainingAmount: nonnegative(bucket.remaining_amount),
          remainingFraction: fraction !== null && fraction <= 1 ? fraction : null,
          resetsAt: Number.isFinite(reset) ? reset : null,
          window: pickString(bucket.window) ?? null,
        },
      ];
    });
    return [{ buckets, name: String(group.name) }];
  });
};

/** Query the installed CLI using its own login; never read or refresh credentials ourselves. */
export const fetchAntigravityQuota = async (
  params: AntigravityQuotaParams = {},
): Promise<AntigravityQuotaSnapshot> => {
  const failure = (errorCode: AntigravityQuotaErrorCode): AntigravityQuotaSnapshot => ({
    error: 'Antigravity quota query failed',
    errorCode,
    groups: [],
    provider: 'antigravity',
    status:
      errorCode === 'auth_required' ||
      errorCode === 'cli_not_found' ||
      errorCode === 'unsupported_client'
        ? 'unavailable'
        : 'error',
    updatedAt: Date.now(),
  });
  try {
    const resolved = await resolveHeteroSpawnCommand('antigravity', params.command);
    const env = {
      ...process.env,
      ...(resolved.pathEnv ? { PATH: resolved.pathEnv } : {}),
      ...params.env,
    };
    const plan = await resolveCliSpawnPlan(
      resolved.command,
      ['-p', '/usage', '--output-format', 'json', '--print-timeout', '15s'],
      env,
    );
    const { stdout } = await execFilePromise(plan.command, plan.args, {
      cwd: tmpdir(),
      encoding: 'utf8',
      env,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      timeout: 20_000,
      windowsHide: true,
    });
    let payload: unknown;
    try {
      payload = JSON.parse(stdout);
    } catch {
      return failure('unsupported_client');
    }
    if (isRecord(payload) && payload.status !== 'SUCCESS') {
      return failure(
        typeof payload.error === 'string' &&
          isHeterogeneousAgentAuthRequired('antigravity', payload.error)
          ? 'auth_required'
          : 'command_failed',
      );
    }
    try {
      return {
        error: null,
        groups: parseAntigravityQuota(payload),
        provider: 'antigravity',
        status: 'ok',
        updatedAt: Date.now(),
      };
    } catch {
      return failure('unsupported_client');
    }
  } catch (error) {
    const record = isRecord(error) ? error : {};
    const detail = `${record.stderr ?? ''} ${record.message ?? ''}`;
    return failure(
      record.code === 'ENOENT'
        ? 'cli_not_found'
        : record.killed || record.code === 'ETIMEDOUT'
          ? 'timeout'
          : isHeterogeneousAgentAuthRequired('antigravity', detail)
            ? 'auth_required'
            : 'command_failed',
    );
  }
};

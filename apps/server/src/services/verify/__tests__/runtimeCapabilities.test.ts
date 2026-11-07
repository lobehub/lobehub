// @vitest-environment node
import type { VerifyCheckItem } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  findUnsatisfiableItems,
  isEnvironmentUnavailableFailure,
  resolveRunCapabilities,
  settleEnvironmentUnavailable,
} from '../runtimeCapabilities';

const { recompute, upsertByCheckItem } = vi.hoisted(() => ({
  recompute: vi.fn(),
  upsertByCheckItem: vi.fn(),
}));

vi.mock('@/database/models/verifyCheckResult', () => ({
  VerifyCheckResultModel: vi.fn(function () {
    return { upsertByCheckItem };
  }),
}));
vi.mock('../statusService', () => ({
  VerifyStatusService: vi.fn(function () {
    return { recompute };
  }),
}));

const item = (id: string, overrides: Partial<VerifyCheckItem> = {}): VerifyCheckItem => ({
  id,
  index: 0,
  onFail: 'manual',
  required: true,
  title: id,
  verifierConfig: {},
  verifierType: 'agent',
  ...overrides,
});

const sandboxItem = item('creds', { verifierConfig: { requiredCapabilities: ['cloud_sandbox'] } });

describe('resolveRunCapabilities', () => {
  it('has a cloud sandbox when no device is routed', () => {
    expect(resolveRunCapabilities({ kind: 'sandbox', target: 'sandbox' }, undefined)).toEqual([
      'cloud_sandbox',
    ]);
  });

  it('has no cloud sandbox when a local device is routed', () => {
    expect(
      resolveRunCapabilities({ deviceId: 'dev-1', kind: 'device', target: 'local' }, 'dev-1'),
    ).toEqual([]);
  });

  it('keeps the cloud sandbox alongside a routed device in auto mode', () => {
    expect(
      resolveRunCapabilities({ deviceId: 'dev-1', kind: 'device', target: 'auto' }, 'dev-1'),
    ).toEqual(['cloud_sandbox']);
  });

  it('has nothing for a plain-chat run', () => {
    expect(resolveRunCapabilities({ kind: 'none', target: 'none' }, undefined)).toEqual([]);
  });

  it('is unknown without an execution plan', () => {
    expect(resolveRunCapabilities(undefined, 'dev-1')).toBeUndefined();
  });
});

describe('findUnsatisfiableItems', () => {
  it('returns required items missing a declared capability', () => {
    expect(findUnsatisfiableItems([sandboxItem, item('plain')], [])).toEqual([
      { item: sandboxItem, missing: ['cloud_sandbox'] },
    ]);
  });

  it('is empty when the capability is available', () => {
    expect(findUnsatisfiableItems([sandboxItem], ['cloud_sandbox'])).toEqual([]);
  });

  it('ignores optional items and unknown capability values', () => {
    expect(
      findUnsatisfiableItems(
        [
          { ...sandboxItem, required: false },
          item('odd', { verifierConfig: { requiredCapabilities: ['gpu'] } }),
        ],
        [],
      ),
    ).toEqual([]);
  });
});

describe('settleEnvironmentUnavailable', () => {
  beforeEach(() => {
    recompute.mockReset();
    upsertByCheckItem.mockReset();
  });

  it('errors the unsatisfiable checks, skips the rest, and recomputes the rollup', async () => {
    const plain = item('plain');

    await settleEnvironmentUnavailable({} as any, 'u1', {
      operationId: 'op-1',
      plan: [sandboxItem, plain],
      unsatisfiable: [{ item: sandboxItem, missing: ['cloud_sandbox'] }],
      verifyRunId: 'run-1',
    });

    expect(upsertByCheckItem).toHaveBeenCalledTimes(2);
    const [errored, skipped] = upsertByCheckItem.mock.calls.map(([row]) => row);
    expect(errored).toMatchObject({
      checkItemId: 'creds',
      status: 'errored',
      verdict: null,
      verifyRunId: 'run-1',
    });
    expect(isEnvironmentUnavailableFailure(errored.toulmin.limitation)).toBe(true);
    expect(errored.toulmin.limitation).toContain('capabilities_missing=cloud_sandbox');
    expect(skipped).toMatchObject({ checkItemId: 'plain', status: 'skipped' });
    // Never a `failed` row: nothing was judged.
    expect(upsertByCheckItem.mock.calls.some(([row]) => row.status === 'failed')).toBe(false);
    expect(recompute).toHaveBeenCalledWith('op-1');
  });
});

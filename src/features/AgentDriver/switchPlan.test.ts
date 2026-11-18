import { describe, expect, it, vi } from 'vitest';

import {
  planDriverRollback,
  planDriverSwitch,
  resolveHarnessModel,
  runDriverSwitch,
} from './switchPlan';

const defaults = { model: 'gpt-5.5', provider: 'openai' };

describe('planDriverSwitch', () => {
  it('moves a LobeHub agent onto a heterogeneous driver in one write', () => {
    const plan = planDriverSwitch({
      currentlyHeterogeneous: false,
      defaults,
      target: { command: 'claude', kind: 'hetero', type: 'claude-code' },
    });

    expect(plan).toEqual([
      {
        agencyConfig: { heterogeneousProvider: { command: 'claude', type: 'claude-code' } },
        provider: 'claude-code',
      },
    ]);
  });

  it('clears the old runtime before writing the new one so no credentials carry over', () => {
    const plan = planDriverSwitch({
      currentlyHeterogeneous: true,
      defaults,
      target: { command: 'codex', kind: 'hetero', type: 'codex' },
    });

    expect(plan).toHaveLength(2);
    expect(plan[0]).toEqual({ agencyConfig: { heterogeneousProvider: null } });
    expect(plan[1]).toMatchObject({ provider: 'codex' });
  });

  it('hands the provider and model back to the default chat model when leaving a runtime', () => {
    const plan = planDriverSwitch({
      currentlyHeterogeneous: true,
      defaults,
      target: { kind: 'harness' },
    });

    expect(plan).toEqual([
      { agencyConfig: { heterogeneousProvider: null }, model: 'gpt-5.5', provider: 'openai' },
    ]);
  });
});

describe('planDriverRollback', () => {
  it('writes the previous provider block and its stamp back', () => {
    const previous = { command: 'claude', env: { A: '1' }, type: 'claude-code' };

    expect(
      planDriverRollback({ heterogeneousProvider: previous, provider: 'claude-code' }),
    ).toEqual({
      agencyConfig: { heterogeneousProvider: previous },
      provider: 'claude-code',
    });
  });
});

describe('runDriverSwitch', () => {
  /**
   * Mirrors `updateAgentConfigById`: a rejected save is toasted by the store and swallowed
   * unless the caller passes `rethrow`, and the store's toast is skipped with
   * `showErrorMessage: false`.
   */
  const storeWriter = (rejectAt: Set<number>) => {
    const storeToasts: string[] = [];
    let call = 0;
    const write = vi.fn(
      async (
        _id: string,
        _patch: unknown,
        options?: { rethrow?: boolean; showErrorMessage?: boolean },
      ) => {
        const index = call++;
        if (!rejectAt.has(index)) return;
        if (options?.showErrorMessage !== false) storeToasts.push('saveAgentConfigFail');
        if (options?.rethrow) throw new Error('Shared agents only support models from: lobehub.');
      },
    );
    return { storeToasts, write };
  };

  const toCodex = planDriverSwitch({
    currentlyHeterogeneous: true,
    defaults,
    target: { command: 'codex', kind: 'hetero', type: 'codex' },
  });
  const previous = {
    heterogeneousProvider: { command: 'claude', type: 'claude-code' },
    provider: 'claude-code',
  };

  it('reports a rejected save as failed, with no store toast on top of the caller one', async () => {
    const { storeToasts, write } = storeWriter(new Set([0]));
    const plan = planDriverSwitch({
      currentlyHeterogeneous: false,
      defaults,
      target: { command: 'claude', kind: 'hetero', type: 'claude-code' },
    });

    await expect(
      runDriverSwitch({
        agentId: 'a',
        plan,
        previous: { heterogeneousProvider: undefined },
        write,
      }),
    ).resolves.toBe('failed');
    expect(storeToasts).toEqual([]);
  });

  it('rolls a clear-then-write switch back when the second write is rejected', async () => {
    const { write } = storeWriter(new Set([1]));

    await expect(runDriverSwitch({ agentId: 'a', plan: toCodex, previous, write })).resolves.toBe(
      'failed',
    );
    expect(write).toHaveBeenCalledTimes(3);
    expect(write.mock.calls[2][1]).toEqual(planDriverRollback(previous));
  });

  it('reports switched only when every write is saved', async () => {
    const { write } = storeWriter(new Set());

    await expect(runDriverSwitch({ agentId: 'a', plan: toCodex, previous, write })).resolves.toBe(
      'switched',
    );
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('leaves the outcome to a newer write that aborted this one', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const write = vi.fn().mockRejectedValueOnce(abort);

    await expect(runDriverSwitch({ agentId: 'a', plan: toCodex, previous, write })).resolves.toBe(
      'superseded',
    );
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('resolveHarnessModel', () => {
  const fallback = { model: 'lobe-flash', provider: 'lobehub' };
  const enabledChatModels = [
    { children: [{ id: 'gpt-5.5' }], id: 'openai' },
    { children: [{ id: 'lobe-pro' }, { id: 'lobe-flash' }], id: 'lobehub' },
  ];

  it('keeps the account default when sharing restricts nothing', () => {
    expect(resolveHarnessModel({ defaults, enabledChatModels, fallback })).toEqual(defaults);
  });

  it('keeps an account default that sharing allows', () => {
    const lobeDefault = { model: 'lobe-pro', provider: 'lobehub' };
    expect(
      resolveHarnessModel({
        allowedProviders: ['lobehub'],
        defaults: lobeDefault,
        enabledChatModels,
        fallback,
      }),
    ).toEqual(lobeDefault);
  });

  it('moves a shared agent onto the deployment default instead of a third-party default', () => {
    expect(
      resolveHarnessModel({ allowedProviders: ['lobehub'], defaults, enabledChatModels, fallback }),
    ).toEqual(fallback);
  });

  it('falls back to the first allowed model when the deployment default is not enabled', () => {
    expect(
      resolveHarnessModel({
        allowedProviders: ['lobehub'],
        defaults,
        enabledChatModels: [{ children: [{ id: 'lobe-pro' }], id: 'lobehub' }],
        fallback,
      }),
    ).toEqual({ model: 'lobe-pro', provider: 'lobehub' });
  });

  it('keeps the account default when no allowed model is enabled, so the server reports it', () => {
    expect(
      resolveHarnessModel({
        allowedProviders: ['lobehub'],
        defaults,
        enabledChatModels: [{ children: [{ id: 'gpt-5.5' }], id: 'openai' }],
        fallback,
      }),
    ).toEqual(defaults);
  });
});

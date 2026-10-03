import type { HeterogeneousProviderConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveHeterogeneousRuntimeConfig } from './heterogeneousRuntimeConfig';

const codex: HeterogeneousProviderConfig = {
  args: ['--model', 'gpt-5.5'],
  effort: 'high',
  speed: 'fast',
  type: 'codex',
};

/** @example Codex Task settings remain inspectable, with a source for every dimension. */
describe('resolveHeterogeneousRuntimeConfig', () => {
  /** @example CLI arguments take precedence over stored Agent selections. */
  it('exposes the effective Agent runtime, model, effort and speed', () => {
    /** @example The Agent model flag, rather than a conflicting stored model, is displayed. */
    expect(resolveHeterogeneousRuntimeConfig({ ...codex, model: 'gpt-5.4' })).toEqual([
      { key: 'runtime', source: 'agent', value: 'codex' },
      { key: 'model', source: 'agent', value: 'gpt-5.5' },
      { key: 'effort', source: 'agent', value: 'high' },
      { key: 'speed', source: 'agent', value: 'fast' },
    ]);
  });

  /** @example Task gpt-5.4 overrides an Agent's --model gpt-5.5. */
  it('identifies a Task override even when its value equals the Agent value', () => {
    /** @example An explicit pin is still Task-owned when values happen to match. */
    expect(
      resolveHeterogeneousRuntimeConfig(codex, { model: 'gpt-5.5', provider: 'codex' })[1],
    ).toEqual({
      key: 'model',
      source: 'task',
      value: 'gpt-5.5',
    });
  });

  /** @example A model-only Task pin inherits the Codex provider, unlike an incomplete Topic pin. */
  it('uses the runtime provider for a model-only Task override', () => {
    // ROOT CAUSE:
    // A connected Agent has no ordinary provider to backfill into the Task.
    // The Topic pin guard rejects an undefined provider, so Task preview and
    // fresh-run dispatch must use the connected runtime identity for this pin.
    /** @example The explicit Task model remains visible and Task-owned. */
    expect(resolveHeterogeneousRuntimeConfig(codex, { model: 'gpt-5.4' })[1]).toEqual({
      key: 'model',
      source: 'task',
      value: 'gpt-5.4',
    });
    /** @example Existing incomplete Topic pins retain their original rejection semantics. */
    expect(resolveHeterogeneousRuntimeConfig(codex, { model: 'gpt-5.4' }, 'topic')[1]).toEqual({
      key: 'model',
      source: 'agent',
      value: 'gpt-5.5',
    });
  });

  /** @example A Topic can pin its own model and reset effort to the CLI default. */
  it('reports Topic model and effort pins independently', () => {
    const fields = resolveHeterogeneousRuntimeConfig(
      codex,
      { effort: 'default', model: 'gpt-5.4', provider: 'codex' },
      'topic',
    );
    /** @example Topic ownership survives an explicit default effort pin. */
    expect(fields.slice(1, 3)).toEqual([
      { key: 'model', source: 'topic', value: 'gpt-5.4' },
      { key: 'effort', source: 'topic', value: 'default' },
    ]);
    /** @example Speed continues to come from the Agent, independently of the Topic pins. */
    expect(fields[3]).toEqual({ key: 'speed', source: 'agent', value: 'fast' });
  });

  /** @example Explicit Fast and Standard Topic pins retain ownership even when values match defaults. */
  it('prioritizes Topic speed provenance over Agent and CLI defaults', () => {
    // ROOT CAUSE:
    // The combined Topic speed and Task inspector changes resolved the pinned
    // value but inferred its source from the value alone. This labelled Fast as
    // Agent-owned and explicit Standard as an unresolved CLI default.
    for (const speed of ['fast', 'default'] as const) {
      const fields = resolveHeterogeneousRuntimeConfig(codex, { speed }, 'topic');
      /** @example A Topic pin owns both Fast and explicit Standard. */
      expect(fields.find((field) => field.key === 'speed')).toEqual({
        key: 'speed',
        source: 'topic',
        value: speed,
      });
    }
    /** @example Inspecting a pinned Topic cannot change the next Task's inherited Fast setting. */
    expect(resolveHeterogeneousRuntimeConfig(codex).find((field) => field.key === 'speed')).toEqual(
      {
        key: 'speed',
        source: 'agent',
        value: 'fast',
      },
    );
  });

  /** @example A regular openai model snapshot is not a Codex subscription pin. */
  it('does not attribute a rejected provider pin to the Task', () => {
    /** @example The same runtime-aware pin rules used by execution reject openai here. */
    expect(
      resolveHeterogeneousRuntimeConfig(codex, { model: 'gpt-4o', provider: 'openai' })[1],
    ).toEqual({
      key: 'model',
      source: 'agent',
      value: 'gpt-5.5',
    });
  });

  /** @example Server-managed API bindings remain Agent-scoped despite stale Topic pins. */
  it('preserves server-default API model ownership', () => {
    /** @example A stale subscription pin cannot replace the actual API binding. */
    expect(
      resolveHeterogeneousRuntimeConfig(
        {
          ...codex,
          apiConfig: { model: 'gpt-5.4', source: 'server-default' },
          authMode: 'api',
        },
        { model: 'gpt-5.5', provider: 'codex' },
        'topic',
      )[1],
    ).toEqual({
      key: 'model',
      source: 'agent',
      value: 'gpt-5.4',
    });
  });

  /** @example Amp exposes its actual mode and has no model selector. */
  it('reports Amp mode without inventing a model dimension', () => {
    // ROOT CAUSE:
    // The shared inspector emitted a model for every runtime, although Amp
    // dispatches only its mode. Use the same capability dimensions as dispatch.
    /** @example An explicit Amp mode is inherited from the Agent. */
    expect(resolveHeterogeneousRuntimeConfig({ mode: 'high', type: 'amp' })).toEqual([
      { key: 'runtime', source: 'agent', value: 'amp' },
      { key: 'mode', source: 'agent', value: 'high' },
    ]);
    /** @example Omitted Amp mode remains an unresolved CLI default. */
    expect(resolveHeterogeneousRuntimeConfig({ type: 'amp' })[1]).toEqual({
      key: 'mode',
      source: 'runtime',
      value: 'default',
    });
  });

  /** @example No explicit model, effort or speed means unresolved CLI defaults. */
  it('does not invent values for device-resolved defaults', () => {
    /** @example Each unset dimension carries the runtime-default source. */
    expect(resolveHeterogeneousRuntimeConfig({ type: 'codex' }).slice(1)).toEqual([
      { key: 'model', source: 'runtime', value: 'default' },
      { key: 'effort', source: 'runtime', value: 'default' },
      { key: 'speed', source: 'runtime', value: 'default' },
    ]);
  });
});

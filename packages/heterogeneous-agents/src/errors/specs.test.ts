import { describe, expect, it } from 'vitest';

import {
  formatHeteroErrorId,
  getHeteroErrorSpec,
  HETERO_ERROR_SPECS,
  isUserSideHeteroError,
} from './specs';
import { HETERO_CATEGORY_NUMERIC_PREFIX } from './taxonomy';

describe('hetero error taxonomy', () => {
  const specs = Object.values(HETERO_ERROR_SPECS);

  it('keys every spec by its own kind', () => {
    for (const [key, spec] of Object.entries(HETERO_ERROR_SPECS)) {
      expect(spec.kind).toBe(key);
    }
  });

  it('assigns numericIds whose leading digit matches the category', () => {
    for (const spec of specs) {
      const leading = Number(String(spec.numericId)[0]);
      expect(leading).toBe(HETERO_CATEGORY_NUMERIC_PREFIX[spec.category]);
      expect(String(spec.numericId)).toHaveLength(4);
    }
  });

  it('keeps numericIds unique — they are an append-only external reference', () => {
    const ids = specs.map((spec) => spec.numericId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only emits guide codes the client can actually render', () => {
    const renderable = new Set([
      'auth_required',
      'cli_not_found',
      'overloaded',
      'rate_limit',
      'working_directory_not_found',
    ]);
    for (const spec of specs) {
      if (spec.guideCode) expect(renderable).toContain(spec.guideCode);
    }
  });

  it('never marks a user-attributed outcome as an operational failure', () => {
    for (const spec of specs) {
      if (spec.attribution === 'user') expect(spec.countAsFailure).toBe(false);
    }
  });

  it('only treats transient kinds as retryable', () => {
    const retryable = specs.filter((spec) => spec.retryable).map((spec) => spec.kind);
    expect(retryable.toSorted()).toEqual(['network_drop', 'server_overloaded', 'server_throttle']);
  });

  it('exposes exactly one fallback bucket', () => {
    const fallbacks = specs.filter((spec) => spec.isFallback).map((spec) => spec.kind);
    expect(fallbacks).toEqual(['agent_failed']);
  });

  it('formats and resolves stable ids', () => {
    expect(formatHeteroErrorId('usage_limit')).toBe('H2001');
    expect(formatHeteroErrorId('agent_failed')).toBe('H9002');
    expect(getHeteroErrorSpec('aborted')?.category).toBe('lifecycle');
    expect(getHeteroErrorSpec('nope')).toBeUndefined();
  });

  it('excludes expected user-side outcomes from failure metrics', () => {
    expect(isUserSideHeteroError('aborted')).toBe(true);
    expect(isUserSideHeteroError('usage_limit')).toBe(true);
    expect(isUserSideHeteroError('network_drop')).toBe(false);
    expect(isUserSideHeteroError('unknown_kind')).toBe(false);
  });
});

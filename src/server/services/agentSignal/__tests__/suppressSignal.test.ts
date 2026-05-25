// @vitest-environment node
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { describe, expect, it } from 'vitest';

import { shouldSuppressSignal } from '../suppressSignal';

describe('shouldSuppressSignal', () => {
  it('returns true when appContext.suppressSignal is explicitly true', () => {
    expect(shouldSuppressSignal({ appContext: { suppressSignal: true } })).toBe(true);
  });

  it('returns true when slug is in SELF_ITERATION_AGENT_SLUGS', () => {
    expect(shouldSuppressSignal({ slug: BUILTIN_AGENT_SLUGS.selfIteration })).toBe(true);
  });

  it('returns false for ordinary user-facing slugs', () => {
    expect(shouldSuppressSignal({ slug: BUILTIN_AGENT_SLUGS.inbox })).toBe(false);
  });

  it('returns false when neither suppressSignal nor a matching slug is set', () => {
    expect(shouldSuppressSignal({})).toBe(false);
    expect(shouldSuppressSignal({ appContext: {} })).toBe(false);
    expect(shouldSuppressSignal({ appContext: { suppressSignal: false } })).toBe(false);
  });

  it('ignores unknown slugs', () => {
    expect(shouldSuppressSignal({ slug: 'unknown-slug' })).toBe(false);
  });
});

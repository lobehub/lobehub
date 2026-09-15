// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  assertDocumentRewriteCreationEnabled,
  DOCUMENT_REWRITE_DISABLED,
  isDocumentRewriteCreationEnabled,
} from './featureGate';

describe('targeted rewrite feature gate', () => {
  it('is enabled by default and accepts explicit true values', () => {
    expect(isDocumentRewriteCreationEnabled({})).toBe(true);
    expect(isDocumentRewriteCreationEnabled({ PAGE_AGENT_TARGETED_REWRITE_ENABLED: '1' })).toBe(
      true,
    );
    expect(() =>
      assertDocumentRewriteCreationEnabled({ PAGE_AGENT_TARGETED_REWRITE_ENABLED: 'true' }),
    ).not.toThrow();
  });

  it.each(['0', 'false'])('blocks new creation when the flag is %s', (value) => {
    const environment = { PAGE_AGENT_TARGETED_REWRITE_ENABLED: value };
    expect(isDocumentRewriteCreationEnabled(environment)).toBe(false);
    expect(() => assertDocumentRewriteCreationEnabled(environment)).toThrow(
      DOCUMENT_REWRITE_DISABLED,
    );
  });
});

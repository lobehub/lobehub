import { describe, expect, it } from 'vitest';

import { heteroAgentSupportsImageInput } from './imageInput';

describe('heteroAgentSupportsImageInput', () => {
  it.each(['claude-code', 'codex', 'grok-build', 'opencode'])('accepts images for %s', (type) => {
    expect(heteroAgentSupportsImageInput(type)).toBe(true);
  });

  it.each(['cursor', 'droid', 'devin', 'trae', 'deepseek-harness', 'openclaw', 'hermes'])(
    'rejects images for text-only %s',
    (type) => {
      expect(heteroAgentSupportsImageInput(type)).toBe(false);
    },
  );

  it('rejects unknown or missing types', () => {
    expect(heteroAgentSupportsImageInput('some-new-agent')).toBe(false);
    expect(heteroAgentSupportsImageInput(undefined)).toBe(false);
  });
});

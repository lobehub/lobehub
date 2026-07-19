import { describe, expect, it } from 'vitest';

import { AmpAdapter, ClaudeCodeAdapter, CodexAdapter } from './adapters';
import { createAdapter, listAgentTypes } from './registry';

describe('registry', () => {
  describe('createAdapter', () => {
    it('creates an AmpAdapter for "amp"', () => {
      const adapter = createAdapter('amp');
      expect(adapter).toBeInstanceOf(AmpAdapter);
    });

    it('creates a ClaudeCodeAdapter for "claude-code"', () => {
      const adapter = createAdapter('claude-code');
      expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
    });

    it('creates a CodexAdapter for "codex"', () => {
      const adapter = createAdapter('codex');
      expect(adapter).toBeInstanceOf(CodexAdapter);
    });

    it('throws for unknown agent type', () => {
      expect(() => createAdapter('unknown-agent')).toThrow('Unknown agent type: "unknown-agent"');
    });
  });

  describe('listAgentTypes', () => {
    it('includes every local CLI adapter', () => {
      const types = listAgentTypes();
      expect(types).toContain('amp');
      expect(types).toContain('claude-code');
      expect(types).toContain('codex');
    });
  });
});

import { describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from './adapters';
import { createAdapter, getPreset, listAgentTypes } from './registry';

describe('registry', () => {
  describe('createAdapter', () => {
    it('creates a ClaudeCodeAdapter for "claude-code"', () => {
      const adapter = createAdapter('claude-code');
      expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
    });

    it('throws for unknown agent type', () => {
      expect(() => createAdapter('unknown-agent')).toThrow('Unknown agent type: "unknown-agent"');
    });
  });

  describe('getPreset', () => {
    it('returns preset with stream-json args for claude-code', () => {
      const preset = getPreset('claude-code');
      expect(preset.baseArgs).toContain('--input-format');
      expect(preset.baseArgs).toContain('--output-format');
      expect(preset.baseArgs).toContain('stream-json');
      expect(preset.baseArgs).toContain('-p');
      expect(preset.promptMode).toBe('stdin');
    });

    it('preset has resumeArgs function', () => {
      const preset = getPreset('claude-code');
      expect(preset.resumeArgs).toBeDefined();
      const args = preset.resumeArgs!('sess_abc');
      expect(args).toContain('--resume');
      expect(args).toContain('sess_abc');
    });

    it('throws for unknown agent type', () => {
      expect(() => getPreset('nope')).toThrow('Unknown agent type: "nope"');
    });
  });

  describe('listAgentTypes', () => {
    it('includes claude-code', () => {
      const types = listAgentTypes();
      expect(types).toContain('claude-code');
    });
  });
});

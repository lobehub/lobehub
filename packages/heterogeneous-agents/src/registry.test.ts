import { describe, expect, it } from 'vitest';

import {
  AmpAdapter,
  ClaudeCodeAdapter,
  CodeBuddyAdapter,
  CodexAdapter,
  CursorAdapter,
  OpenCodeAdapter,
  PiAdapter,
  QoderAdapter,
} from './adapters';
import { HETEROGENEOUS_AGENT_CONFIGS } from './config';
import { createAdapter, listAgentTypes, listLocalAgentTypes } from './registry';

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

    it('creates a CodeBuddyAdapter for "codebuddy"', () => {
      expect(createAdapter('codebuddy')).toBeInstanceOf(CodeBuddyAdapter);
    });

    it('creates a CodexAdapter for "codex"', () => {
      const adapter = createAdapter('codex');
      expect(adapter).toBeInstanceOf(CodexAdapter);
    });

    it('creates a CursorAdapter for "cursor"', () => {
      expect(createAdapter('cursor')).toBeInstanceOf(CursorAdapter);
    });

    it('creates an OpenCodeAdapter for "opencode"', () => {
      expect(createAdapter('opencode')).toBeInstanceOf(OpenCodeAdapter);
    });

    it('creates a PiAdapter for "pi"', () => {
      expect(createAdapter('pi')).toBeInstanceOf(PiAdapter);
    });

    it('creates a QoderAdapter for "qoder"', () => {
      expect(createAdapter('qoder')).toBeInstanceOf(QoderAdapter);
    });

    it('throws for unknown agent type', () => {
      expect(() => createAdapter('unknown-agent')).toThrow('Unknown agent type: "unknown-agent"');
    });
  });

  describe('listAgentTypes', () => {
    it('registers exactly one local adapter for every descriptor', () => {
      expect(listLocalAgentTypes().toSorted()).toEqual(
        HETEROGENEOUS_AGENT_CONFIGS.map(({ type }) => type).toSorted(),
      );
      expect(listAgentTypes()).toContain('claude-code-sdk');
    });
  });
});

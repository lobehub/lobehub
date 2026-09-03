import { describe, expect, it } from 'vitest';

import {
  AmpAdapter,
  ClaudeCodeAdapter,
  CodeBuddyAdapter,
  CodexAdapter,
  CursorAcpAdapter,
  CursorAdapter,
  DroidAcpAdapter,
  GrokBuildAdapter,
  KimiCodeAdapter,
  OpenCodeAdapter,
  PiAdapter,
  QoderAdapter,
  TraeAcpAdapter,
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

    it('creates a KimiCodeAdapter for "kimi-code"', () => {
      expect(createAdapter('kimi-code')).toBeInstanceOf(KimiCodeAdapter);
    });

    it('creates a CursorAdapter for "cursor"', () => {
      expect(createAdapter('cursor')).toBeInstanceOf(CursorAdapter);
    });

    it('creates a CursorAcpAdapter for the native ACP runtime', () => {
      expect(createAdapter('cursor-acp')).toBeInstanceOf(CursorAcpAdapter);
    });

    it('creates a DroidAcpAdapter for Droid and its ACP runtime alias', () => {
      expect(createAdapter('droid')).toBeInstanceOf(DroidAcpAdapter);
      expect(createAdapter('droid-acp')).toBeInstanceOf(DroidAcpAdapter);
    });

    it('creates a GrokBuildAdapter for "grok-build"', () => {
      expect(createAdapter('grok-build')).toBeInstanceOf(GrokBuildAdapter);
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

    it('creates a TraeAcpAdapter for "trae"', () => {
      expect(createAdapter('trae')).toBeInstanceOf(TraeAcpAdapter);
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
      expect(listAgentTypes()).toContain('cursor-acp');
      expect(listAgentTypes()).toContain('droid-acp');
    });
  });
});

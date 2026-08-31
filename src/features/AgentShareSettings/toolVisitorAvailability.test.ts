import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { KnowledgeBaseIdentifier } from '@lobechat/builtin-tool-knowledge-base';
import { MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import { describe, expect, it } from 'vitest';

import {
  getShareToolAvailability,
  getVisitorVisibleEnabledToolIds,
  runtimeManagedShareCandidateToolIds,
  toggleShareToolId,
} from './toolVisitorAvailability';

describe('getShareToolAvailability', () => {
  it('blocks builtins the server gate refuses outright', () => {
    // Both survive the master allowlist only to be blocked by
    // DATA_TOOL_ACCESS_RULES' unconditional `none` grant.
    expect(getShareToolAvailability(KnowledgeBaseIdentifier)).toBe('blocked');
    expect(getShareToolAvailability(AgentDocumentsIdentifier)).toBe('blocked');
  });

  it('blocks builtins outside the master allowlist', () => {
    expect(getShareToolAvailability('lobe-local-system')).toBe('blocked');
    expect(getShareToolAvailability('lobe-cloud-sandbox')).toBe('blocked');
  });

  it('leaves non-builtin identifiers to the owner picker', () => {
    expect(getShareToolAvailability('mcp-github')).toBe('available');
  });

  it('flags memory as inert until the read-memory permission is on', () => {
    expect(getShareToolAvailability(MemoryIdentifier)).toBe('needsMemoryPermission');
    expect(getShareToolAvailability(MemoryIdentifier, { allowReadMemory: true })).toBe('available');
  });
});

describe('runtimeManagedShareCandidateToolIds', () => {
  it('never suggests a tool the gate always blocks', () => {
    expect(runtimeManagedShareCandidateToolIds).not.toContain(KnowledgeBaseIdentifier);
    expect(runtimeManagedShareCandidateToolIds).not.toContain('lobe-local-system');
  });
});

describe('getVisitorVisibleEnabledToolIds', () => {
  it('hides persisted grants the gate can never honor', () => {
    expect(
      getVisitorVisibleEnabledToolIds(['mcp-github', KnowledgeBaseIdentifier, 'lobe-local-system']),
    ).toEqual(['mcp-github']);
  });

  it('tolerates an unset whitelist', () => {
    expect(getVisitorVisibleEnabledToolIds(undefined)).toEqual([]);
  });
});

describe('toggleShareToolId', () => {
  it('adds and removes over the stored array', () => {
    expect(toggleShareToolId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleShareToolId(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleShareToolId(undefined, 'a')).toEqual(['a']);
  });

  it('preserves ids the picker never renders', () => {
    // `lobe-local-system` is filtered out of the display list; toggling an
    // unrelated tool must not silently drop it from the persisted whitelist.
    const stored = ['lobe-local-system', 'mcp-github'];

    expect(toggleShareToolId(stored, 'calculator')).toEqual([
      'lobe-local-system',
      'mcp-github',
      'calculator',
    ]);
    expect(toggleShareToolId(stored, 'mcp-github')).toEqual(['lobe-local-system']);
  });
});

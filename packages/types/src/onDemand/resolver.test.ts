import { describe, expect, it } from 'vitest';

import {
  compareOnDemandDynamicEntries,
  isOnDemandBootstrapApiAllowed,
  isOnDemandHardFloorEntry,
  ON_DEMAND_KIND_RANK,
  resolveOnDemandEntryClass,
} from './resolver';
import { ON_DEMAND_DYNAMIC_KINDS, type OnDemandDynamicEntry } from './types';

const makeEntry = (overrides: Partial<OnDemandDynamicEntry> = {}): OnDemandDynamicEntry => ({
  content: 'content',
  estimatedTokens: 1,
  key: 'entry',
  kind: 'memory',
  priority: 1,
  provenance: {
    contentHash: 'hash',
    source: { id: 'source', type: 'memory' },
  },
  relevance: 0.5,
  required: false,
  source: { id: 'source', type: 'memory' },
  ...overrides,
});

describe('on-demand shared resolver', () => {
  it('covers every required dynamic kind with a deterministic rank', () => {
    expect(ON_DEMAND_DYNAMIC_KINDS).toEqual([
      'memory',
      'explicit_constraint',
      'preference',
      'approved_expertise',
      'unapproved_suggestion',
      'skill_card',
      'document_card',
      'tool_card',
      'tool_contract',
      'environment',
      'safety',
      'pending_action',
    ]);
    expect(Object.keys(ON_DEMAND_KIND_RANK).sort()).toEqual([...ON_DEMAND_DYNAMIC_KINDS].sort());
  });

  it('protects hard-floor categories and explicit required entries', () => {
    expect(isOnDemandHardFloorEntry(makeEntry({ kind: 'safety' }))).toBe(true);
    expect(isOnDemandHardFloorEntry(makeEntry({ kind: 'pending_action' }))).toBe(true);
    expect(isOnDemandHardFloorEntry(makeEntry({ kind: 'tool_contract' }))).toBe(true);
    expect(resolveOnDemandEntryClass(makeEntry({ required: true }))).toBe('protected');
    expect(resolveOnDemandEntryClass(makeEntry())).toBe('degradable');
  });

  it('enforces the bootstrap API allowlist', () => {
    expect(isOnDemandBootstrapApiAllowed('lobe-activator', 'activateTools')).toBe(true);
    expect(isOnDemandBootstrapApiAllowed('lobe-activator', 'invoke')).toBe(false);
    expect(isOnDemandBootstrapApiAllowed('unknown-tool', 'read')).toBe(false);
  });

  it('uses stable source and provenance fields as final tie breakers', () => {
    const first = makeEntry({
      key: 'same',
      provenance: {
        contentHash: 'a',
        source: { id: 'a', type: 'memory' },
      },
      source: { id: 'a', type: 'memory' },
    });
    const second = makeEntry({
      key: 'same',
      provenance: {
        contentHash: 'b',
        source: { id: 'b', type: 'memory' },
      },
      source: { id: 'b', type: 'memory' },
    });

    expect(compareOnDemandDynamicEntries(first, second)).toBeLessThan(0);
    expect(compareOnDemandDynamicEntries(second, first)).toBeGreaterThan(0);
  });
});

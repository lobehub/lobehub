import { afterEach, describe, expect, it } from 'vitest';

import {
  fromWireToolIdentifier,
  getToolIdNamespace,
  setToolIdNamespace,
  ToolNameResolver,
  toWireToolIdentifier,
} from '../ToolNameResolver';

const resolver = new ToolNameResolver();

afterEach(() => {
  // Reset to the default so a stray namespace can't leak into other cases.
  setToolIdNamespace(undefined);
});

// Regression for a white-label deployment's model inferring "I am LobeHub"
// purely from its own tool names: builtin tool identifiers are `lobe-*`
// (persisted verbatim in message history), so BUILTIN_TOOL_ID_NAMESPACE swaps
// only the wire-visible prefix, never the canonical registry key.
describe('tool identifier wire namespace', () => {
  it('defaults to the canonical "lobe" namespace (unchanged behavior)', () => {
    expect(getToolIdNamespace()).toBe('lobe');
    expect(toWireToolIdentifier('lobe-web-browsing')).toBe('lobe-web-browsing');
    expect(fromWireToolIdentifier('lobe-web-browsing')).toBe('lobe-web-browsing');
  });

  it('rewrites the lobe- prefix on the wire when a namespace is configured', () => {
    setToolIdNamespace('ttw');
    expect(toWireToolIdentifier('lobe-web-browsing')).toBe('ttw-web-browsing');
    // Identifiers that were never lobe-prefixed (skill slugs) pass through.
    expect(toWireToolIdentifier('acceptance')).toBe('acceptance');
  });

  it('recovers the canonical identifier from a namespaced wire name', () => {
    setToolIdNamespace('ttw');
    expect(fromWireToolIdentifier('ttw-web-browsing')).toBe('lobe-web-browsing');
  });

  it('still accepts a literal lobe- wire name for backward compatibility', () => {
    // A conversation started before the namespace was configured (or resumed
    // from before it was set) still carries literal `lobe-*` wire names —
    // the manifest registry itself was never renamed, so these must keep
    // resolving without a data migration.
    setToolIdNamespace('ttw');
    expect(fromWireToolIdentifier('lobe-web-browsing')).toBe('lobe-web-browsing');
  });

  it('round-trips generate/resolve end-to-end under a configured namespace', () => {
    setToolIdNamespace('ttw');

    const manifests = {
      'lobe-web-browsing': {
        api: [{ description: '', name: 'search', parameters: {} }],
        identifier: 'lobe-web-browsing',
        meta: {},
        type: 'builtin' as any,
      },
    };

    const wireName = resolver.generate('lobe-web-browsing', 'search', 'builtin');
    expect(wireName).toBe('ttw-web-browsing____search');
    expect(wireName).not.toContain('lobe-');

    const [resolved] = resolver.resolve(
      [{ function: { arguments: '{}', name: wireName }, id: 'call_1', type: 'function' }],
      manifests,
    );
    expect(resolved.identifier).toBe('lobe-web-browsing');
    expect(resolved.apiName).toBe('search');
  });

  it('ignores an invalid namespace value and falls back to canonical', () => {
    setToolIdNamespace('has spaces');
    expect(getToolIdNamespace()).toBe('lobe');
  });
});

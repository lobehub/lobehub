import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import { setToolIdNamespace } from '@lobechat/context-engine';
import { afterEach, describe, expect, it } from 'vitest';

import { buildToolDiscoveryConfig } from '../executorHelpers';

afterEach(() => {
  setToolIdNamespace(undefined);
});

// Regression for the "I am LobeHub" brand leak: `<available_tools>` is built
// from this config, and its `identifier` field is what a white-label
// deployment's model reads directly — it must never carry the canonical
// `lobe-*` registry key when a wire namespace is configured.
describe('buildToolDiscoveryConfig — wire namespace', () => {
  const operationToolSet = {
    manifestMap: {
      'lobe-web-browsing': { meta: { description: 'Search the web', title: 'Web Browsing' } },
    },
  } as any;

  it('exposes the canonical identifier when no namespace is configured', () => {
    const config = buildToolDiscoveryConfig(operationToolSet, [LobeActivatorIdentifier]);
    expect(config?.availableTools).toEqual([
      expect.objectContaining({ identifier: 'lobe-web-browsing' }),
    ]);
  });

  it('exposes the wire-namespaced identifier when one is configured', () => {
    setToolIdNamespace('ttw');
    const config = buildToolDiscoveryConfig(operationToolSet, [LobeActivatorIdentifier]);
    expect(config?.availableTools).toEqual([
      expect.objectContaining({ identifier: 'ttw-web-browsing' }),
    ]);
    expect(JSON.stringify(config)).not.toContain('lobe-web-browsing');
  });
});

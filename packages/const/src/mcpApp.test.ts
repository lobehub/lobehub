import { describe, expect, it } from 'vitest';

import {
  buildMcpToolMetadata,
  getMcpServerFingerprint,
  getMcpToolVisibility,
  isMcpToolVisibleTo,
  isSyncedMcpToolVisibleTo,
  lacksUiResourceMeta,
  partitionMcpToolsForViews,
  withListingUiMeta,
} from './mcpApp';

describe('getMcpToolVisibility', () => {
  it('reads `_meta.ui.visibility`, keeping only strings', () => {
    expect(getMcpToolVisibility({ ui: { visibility: ['app', 1, 'model'] } })).toEqual([
      'app',
      'model',
    ]);
  });

  it('returns undefined when the tool declares none', () => {
    expect(getMcpToolVisibility(undefined)).toBeUndefined();
    expect(getMcpToolVisibility({ ui: { resourceUri: 'ui://x' } })).toBeUndefined();
    expect(getMcpToolVisibility({ ui: { visibility: 'app' } })).toBeUndefined();
  });
});

describe('isMcpToolVisibleTo', () => {
  it('treats an unset visibility as visible to both', () => {
    expect(isMcpToolVisibleTo(undefined, 'model')).toBe(true);
    expect(isMcpToolVisibleTo(undefined, 'app')).toBe(true);
  });

  it('allows only the listed audiences', () => {
    expect(isMcpToolVisibleTo(['app'], 'model')).toBe(false);
    expect(isMcpToolVisibleTo(['app'], 'app')).toBe(true);
    expect(isMcpToolVisibleTo(['model'], 'app')).toBe(false);
    expect(isMcpToolVisibleTo([], 'model')).toBe(false);
  });
});

describe('synced tool metadata', () => {
  it('round-trips the declared visibility through the row metadata', () => {
    const row = { metadata: buildMcpToolMetadata(['app']) };

    expect(row.metadata).toEqual({ visibility: ['app'] });
    expect(isSyncedMcpToolVisibleTo(row, 'model')).toBe(false);
    expect(isSyncedMcpToolVisibleTo(row, 'app')).toBe(true);
  });

  it('stores nothing for an undeclared visibility, which stays visible to the model', () => {
    expect(buildMcpToolMetadata(undefined)).toBeNull();
    expect(isSyncedMcpToolVisibleTo({ metadata: null }, 'model')).toBe(true);
    expect(isSyncedMcpToolVisibleTo({}, 'model')).toBe(true);
  });
});

describe('partitionMcpToolsForViews', () => {
  const tool = (name: string, visibility?: string[]) => ({
    _meta: visibility ? { ui: { visibility } } : undefined,
    name,
  });

  it("keeps what views may call beyond the model's list, and what they may not", () => {
    const { appOnlyTools, modelOnlyToolNames } = partitionMcpToolsForViews([
      tool('both'),
      tool('model', ['model']),
      tool('app', ['app']),
      tool('none', []),
    ]);

    expect(appOnlyTools.map((t) => t.name)).toEqual(['app']);
    expect(modelOnlyToolNames).toEqual(['model']);
  });
});

describe('withListingUiMeta', () => {
  const csp = { connectDomains: ['https://api.example.com'] };

  it("fills a view's metadata from its resources/list entry when the read declares none", () => {
    const result = { contents: [{ text: '<html />', uri: 'ui://app' }] };

    expect(lacksUiResourceMeta(result)).toBe(true);
    expect(
      withListingUiMeta(result, 'ui://app', [
        { _meta: { ui: { csp: { connectDomains: [] } } }, uri: 'ui://other' },
        { _meta: { ui: { csp } }, uri: 'ui://app' },
      ]).contents,
    ).toEqual([{ _meta: { ui: { csp } }, text: '<html />', uri: 'ui://app' }]);
  });

  it("keeps the read's own metadata, which the listing only backs up", () => {
    const own = { _meta: { ui: { csp: { connectDomains: [] } } }, text: '', uri: 'ui://app' };

    expect(lacksUiResourceMeta({ contents: [own] })).toBe(false);
    expect(
      withListingUiMeta({ contents: [own] }, 'ui://app', [
        { _meta: { ui: { csp } }, uri: 'ui://app' },
      ]).contents,
    ).toEqual([own]);
  });
});

describe('getMcpServerFingerprint', () => {
  it('names a server the same however it is reached, and keeps its address out', async () => {
    const url = 'https://mcp.example.com/mcp?token=secret';
    const http = await getMcpServerFingerprint({ type: 'http', url });

    expect(http).toMatch(/^[\da-f]{64}$/);
    expect(http).not.toContain('secret');
    expect(await getMcpServerFingerprint({ type: 'http', url })).toBe(http);
    expect(
      await getMcpServerFingerprint({ args: ['mcp.js'], command: 'node', type: 'stdio' }),
    ).toBe(await getMcpServerFingerprint({ args: ['mcp.js'], command: 'node', type: 'stdio' }));
  });

  it('tells different servers apart', async () => {
    const fingerprints = await Promise.all([
      getMcpServerFingerprint({ type: 'http', url: 'https://a.example.com/mcp' }),
      getMcpServerFingerprint({ type: 'http', url: 'https://b.example.com/mcp' }),
      getMcpServerFingerprint({ args: ['a.js'], command: 'node', type: 'stdio' }),
      getMcpServerFingerprint({ args: ['b.js'], command: 'node', type: 'stdio' }),
      // Not the same as one argument holding both
      getMcpServerFingerprint({ args: ['a.js b.js'], command: 'node', type: 'stdio' }),
      getMcpServerFingerprint({ args: ['a.js', 'b.js'], command: 'node', type: 'stdio' }),
      // So are the headers a gateway may route by
      getMcpServerFingerprint({
        headers: { 'x-tenant': 'a' },
        type: 'http',
        url: 'https://a.example.com/mcp',
      }),
      // The environment, which may pick the endpoint, is part of it
      getMcpServerFingerprint({
        args: ['a.js'],
        command: 'node',
        env: { URL: 'b' },
        type: 'stdio',
      }),
    ]);

    // In any order, and an empty one is none
    expect(
      await getMcpServerFingerprint({
        command: 'node',
        env: { A: '1', B: '2' },
        type: 'stdio',
      }),
    ).toBe(
      await getMcpServerFingerprint({ command: 'node', env: { B: '2', A: '1' }, type: 'stdio' }),
    );
    expect(await getMcpServerFingerprint({ command: 'node', env: {}, type: 'stdio' })).toBe(
      await getMcpServerFingerprint({ command: 'node', type: 'stdio' }),
    );

    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });
});

describe('getMcpServerFingerprint outside a secure context', () => {
  it('names the server the same without crypto.subtle', async () => {
    const address = { type: 'http' as const, url: 'http://10.0.0.5:3000/mcp' };
    const fingerprint = await getMcpServerFingerprint(address);
    const subtle = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
    Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: undefined });
    try {
      await expect(getMcpServerFingerprint(address)).resolves.toBe(fingerprint);
    } finally {
      if (subtle) Object.defineProperty(globalThis.crypto, 'subtle', subtle);
    }
  });
});

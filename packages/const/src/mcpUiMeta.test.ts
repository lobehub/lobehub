import { describe, expect, it } from 'vitest';

import {
  getMcpToolVisibility,
  lacksUiResourceMeta,
  partitionMcpToolsForViews,
  withListingUiMeta,
} from './mcpApp';
import { resolveMcpUiResourceMeta, resolveMcpUiToolMeta } from './mcpUiMeta';

describe('MCP UI compatibility', () => {
  it.each([
    [{ 'openai/outputTemplate': 'ui://old' }, 'ui://old'],
    [{ 'openai/outputTemplate': 'ui://old', 'ui/resourceUri': 'ui://flat' }, 'ui://flat'],
    [
      {
        'openai/outputTemplate': 'ui://old',
        'ui/resourceUri': 'ui://flat',
        'ui': { resourceUri: 'ui://standard' },
      },
      'ui://standard',
    ],
    [{ 'openai/outputTemplate': 'https://invalid' }, undefined],
    [{ 'openai/outputTemplate': 'ui://old', 'ui': { resourceUri: false } }, undefined],
  ])('resolves URI precedence: %j', (meta, expected) => {
    expect(resolveMcpUiToolMeta(meta).resourceUri).toBe(expected);
  });

  it('overrides individual extension fields without dropping other fields', () => {
    expect(
      resolveMcpUiToolMeta({
        'lobehub/ui': { preferredModelDisplayMode: 'inline' },
        'openai/ui': { entrypoints: [{ type: 'thread' }], preferredModelDisplayMode: 'fullscreen' },
      }),
    ).toEqual({ entrypoints: [{ type: 'thread' }], preferredModelDisplayMode: 'inline' });
    expect(
      resolveMcpUiResourceMeta({
        'lobehub/ui': { preferredDisplayMode: 'inline' },
        'openai/ui': {
          availableDisplayModes: ['inline', 'fullscreen'],
          preferredDisplayMode: 'fullscreen',
        },
      }),
    ).toEqual({ availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'inline' });
  });

  it('discards invalid declarations and invalid overrides', () => {
    expect(
      resolveMcpUiToolMeta({
        'lobehub/ui': { preferredModelDisplayMode: 'pip' },
        'openai/ui': {
          entrypoints: [{ type: 'unknown' }, { type: 'file', extensions: [123] }],
          preferredModelDisplayMode: 'fullscreen',
        },
      }),
    ).toEqual({ entrypoints: [] });
    expect(
      resolveMcpUiToolMeta({
        'openai/ui': { entrypoints: Array.from({ length: 4 }, () => ({ type: 'thread' })) },
      }),
    ).toEqual({});
    expect(
      resolveMcpUiResourceMeta({
        'openai/ui': {
          availableDisplayModes: ['pip', 'sidebar', 4, 'inline'],
          preferredDisplayMode: 'sidebar',
        },
      }),
    ).toEqual({ availableDisplayModes: ['pip', 'inline'] });
    for (const value of [undefined, null, 4, 'bad', []]) {
      expect(resolveMcpUiToolMeta(value)).toEqual({});
      expect(resolveMcpUiResourceMeta(value)).toEqual({});
    }
  });

  it('prefers standard resource fields and maps legacy CSP names', () => {
    expect(
      resolveMcpUiResourceMeta({
        'openai/widgetCSP': {
          connect_domains: ['https://api.test', 3],
          frame_domains: ['https://frame.test'],
          resource_domains: ['https://cdn.test'],
        },
        'openai/widgetDomain': 'https://old.test',
        'openai/widgetPrefersBorder': true,
        'ui': { domain: 'https://new.test', prefersBorder: false },
      }),
    ).toEqual({
      csp: {
        connectDomains: ['https://api.test'],
        frameDomains: ['https://frame.test'],
        resourceDomains: ['https://cdn.test'],
      },
      domain: 'https://new.test',
      prefersBorder: false,
    });
    expect(
      resolveMcpUiResourceMeta({
        'openai/widgetCSP': { connect_domains: ['https://old.test'] },
        'ui': { csp: {} },
      }),
    ).toEqual({ csp: {} });
  });

  it('preserves standard visibility and supports legacy private tools only when enabled', () => {
    const legacy = { 'openai/visibility': 'private', 'openai/widgetAccessible': true };
    expect(getMcpToolVisibility(legacy, true)).toEqual(['app']);
    expect(getMcpToolVisibility({ ...legacy, ui: { visibility: ['model'] } }, true)).toEqual([
      'model',
    ]);
    expect(getMcpToolVisibility(legacy, false)).toBeUndefined();
    expect(
      partitionMcpToolsForViews([{ _meta: legacy, name: 'private' }], false).appOnlyTools,
    ).toEqual([]);
    expect(
      partitionMcpToolsForViews([{ _meta: legacy, name: 'private' }], true).appOnlyTools,
    ).toHaveLength(1);
  });

  it('never reads compatibility fields with the feature disabled', () => {
    const meta = { ui: { resourceUri: 'ui://standard', visibility: ['model'] } };
    for (const key of [
      'openai/outputTemplate',
      'openai/visibility',
      'openai/widgetAccessible',
      'openai/ui',
      'lobehub/ui',
    ]) {
      Object.defineProperty(meta, key, {
        get: () => {
          throw new Error('Compatibility field read while disabled');
        },
      });
    }
    expect(resolveMcpUiToolMeta(meta, false)).toEqual({
      resourceUri: 'ui://standard',
      visibility: ['model'],
    });
  });

  it('uses resource listing compatibility metadata only when enabled', () => {
    const meta = {
      'lobehub/ui': { availableDisplayModes: ['fullscreen'] },
      'openai/widgetPrefersBorder': false,
    };
    const listing = [{ _meta: meta, uri: 'ui://app' }];
    const result = { contents: [{ uri: 'ui://app' }] };
    expect(withListingUiMeta(result, 'ui://app', listing, false)).toBe(result);
    expect(withListingUiMeta(result, 'ui://app', listing, true).contents[0]._meta).toEqual(meta);
    expect(lacksUiResourceMeta({ contents: listing }, true)).toBe(false);
    expect(lacksUiResourceMeta({ contents: listing }, false)).toBe(true);
  });
});

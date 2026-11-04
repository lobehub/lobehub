import { describe, expect, it } from 'vitest';

import {
  buildMcpToolMetadata,
  getMcpToolVisibility,
  isMcpToolVisibleTo,
  isSyncedMcpToolVisibleTo,
  partitionMcpToolsForViews,
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

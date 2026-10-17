import { describe, expect, it } from 'vitest';

import { projectAcceptanceRouteMeta, projectConversationRouteMeta } from './routeMeta';

describe('project route metas', () => {
  it('resolves the conversation tab title dynamically', () => {
    expect(projectConversationRouteMeta.titleKey).toBe('project:topics.title');
    expect(projectConversationRouteMeta.DynamicMeta).toBeDefined();
  });

  // Regression: route metas are bundled with the router on first paint, and the
  // conversation runner reads the chat and project stores. Importing it statically
  // pulled those stores into the desktop entry graph (+650 KB gzip).
  it('loads the conversation title runner lazily', () => {
    expect(
      (projectConversationRouteMeta.DynamicMeta as unknown as { $$typeof: symbol }).$$typeof,
    ).toBe(Symbol.for('react.lazy'));
  });

  // Regression: the project acceptance section reused `acceptanceRouteMeta`,
  // whose DynamicMeta cannot read an `:acceptanceId` here, so every project
  // acceptance tab was persisted with the generic fallback title.
  it('gives the project acceptance section its own static title and no runner', () => {
    expect(projectAcceptanceRouteMeta.titleKey).toBe('project:sections.acceptance');
    expect(projectAcceptanceRouteMeta.icon).toBeDefined();
    expect(projectAcceptanceRouteMeta.DynamicMeta).toBeUndefined();
  });
});

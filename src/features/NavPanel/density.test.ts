import { describe, expect, it } from 'vitest';

import { resolveHeaderContentInset, resolveNavItemMetrics } from './density';

describe('resolveNavItemMetrics', () => {
  it('keeps 36px rows and the default radius outside the nav panel', () => {
    expect(resolveNavItemMetrics(null)).toMatchObject({ radius: undefined, rowHeight: 36 });
  });

  it('uses 32px rows with 28px section headers in a compact nav panel', () => {
    expect(resolveNavItemMetrics('compact')).toMatchObject({
      fontSize: 13,
      rowHeight: 32,
      sectionTriggerPaddingBlock: 2,
    });
  });

  it('scales the panel header down with compact rows', () => {
    expect(resolveNavItemMetrics('compact')).toMatchObject({
      headerAvatarSize: 24,
      headerLabelFontSize: 13,
    });
    expect(resolveNavItemMetrics(null)).toMatchObject({
      headerAvatarSize: 28,
      headerLabelFontSize: 14,
      headerTitleFontSize: 16,
    });
  });

  it('uses 36px rows with 32px section headers in a loose nav panel', () => {
    expect(resolveNavItemMetrics('loose')).toMatchObject({
      fontSize: 14,
      rowHeight: 36,
      sectionTriggerPaddingBlock: 4,
    });
  });
});

describe('resolveHeaderContentInset', () => {
  it('lands the header avatar on the row icon column in every density', () => {
    // Rows pad by panelPaddingInline + paddingInline; a switcher adds 2px of its
    // own, so the header inset has to leave exactly that space for it.
    const compact = resolveNavItemMetrics('compact');
    const loose = resolveNavItemMetrics('loose');

    expect(resolveHeaderContentInset(compact, 2) + 2).toBe(
      compact.panelPaddingInline + compact.paddingInline,
    );
    expect(resolveHeaderContentInset(loose, 2) + 2).toBe(
      loose.panelPaddingInline + loose.paddingInline,
    );
  });

  it('gives a header without a switcher the row inset itself', () => {
    const loose = resolveNavItemMetrics('loose');

    expect(resolveHeaderContentInset(loose)).toBe(
      loose.panelPaddingInline + loose.paddingInline,
    );
  });
});

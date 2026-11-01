import type { SettingsSectionsShape } from './Sections';

/**
 * Per-tab section shapes for settings pages whose layout is not a plain form.
 * Measured against the settled pages at a 1440px-wide window: filled group heads
 * are 57px (76px with a description, 64px with an action button), sections are
 * 36px apart, and the first section starts 24px below the navigation header.
 * Rows below the first viewport are a plausible fill, not a promise.
 */
export const SETTINGS_SECTION_SHAPES: Record<string, SettingsSectionsShape> = {
  billing: {
    sections: [
      { titleWidth: 72, variant: 'summary' },
      { extra: true, lines: 13, titleWidth: 72, variant: 'detail' },
      { rows: 1, titleWidth: 72, variant: 'table' },
    ],
  },
  credits: {
    sections: [
      { aside: { height: 200, width: 350 }, secondary: true, titleWidth: 40, variant: 'summary' },
      {
        cards: 6,
        columns: 3,
        footer: true,
        gap: 8,
        grouped: true,
        size: 'small',
        titleWidth: 72,
        variant: 'cards',
      },
      { desc: true, field: true, titleWidth: 112, variant: 'form' },
      { desc: true, field: true, titleWidth: 72, variant: 'form' },
      { tabs: true, rows: 2, titleWidth: 88, variant: 'table' },
    ],
  },
  plans: {
    sections: [
      {
        cards: 3,
        columns: 3,
        gap: 12,
        toolbar: { gap: 24, height: 44, width: 304 },
        variant: 'cards',
      },
    ],
  },
  referral: {
    sections: [
      { variant: 'banner' },
      { desc: true, field: true, titleWidth: 104, variant: 'form' },
      { desc: true, field: true, titleWidth: 88, variant: 'form' },
      { columns: 4, desc: true, tileHeight: 95, tiles: 4, titleWidth: 72, variant: 'tiles' },
      { rows: 1, titleWidth: 72, variant: 'table' },
    ],
  },
  usage: {
    sections: [
      { columns: 2, tiles: 4, titleWidth: 40, variant: 'tiles' },
      { rows: 4, titleWidth: 40, toolbar: true, variant: 'table' },
    ],
  },
};

/**
 * Shapes for the same tabs inside the workspace settings content layout, whose
 * pages stack sections 16px apart. That layout draws the navigation header and
 * the padded container, so these render as bare bodies under it.
 */
export const WORKSPACE_SETTINGS_SECTION_SHAPES: Record<
  'billing' | 'budget' | 'credits' | 'plans' | 'usage',
  SettingsSectionsShape
> = {
  billing: {
    gap: 16,
    sections: [
      { titleWidth: 96, variant: 'summary' },
      { rows: 2, titleWidth: 120, variant: 'form' },
      { rows: 2, titleWidth: 96, variant: 'table' },
    ],
  },
  budget: {
    gap: 16,
    sections: [
      { desc: true, rows: 1, titleWidth: 120, variant: 'form' },
      { desc: true, extra: true, rows: 2, titleWidth: 120, variant: 'form' },
      { desc: true, rows: 3, titleWidth: 120, variant: 'table' },
    ],
  },
  credits: {
    gap: 16,
    sections: [
      { secondary: true, titleWidth: 72, variant: 'summary' },
      { rows: 2, titleWidth: 96, variant: 'form' },
      { desc: true, rows: 2, titleWidth: 96, variant: 'form' },
      { tabs: true, rows: 2, titleWidth: 96, variant: 'table' },
    ],
  },
  plans: {
    gap: 24,
    sections: [
      {
        cards: 3,
        columns: 3,
        gap: 16,
        toolbar: { gap: 16, height: 44, width: 360 },
        variant: 'cards',
      },
    ],
  },
  usage: {
    gap: 16,
    sections: [
      { columns: 2, extra: true, tiles: 4, titleWidth: 72, variant: 'tiles' },
      { rows: 5, titleWidth: 96, toolbar: true, variant: 'table' },
    ],
  },
};

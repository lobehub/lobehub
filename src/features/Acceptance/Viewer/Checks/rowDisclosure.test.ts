import { describe, expect, it, vi } from 'vitest';

import { checkRowDisclosure } from './rowDisclosure';

describe('checkRowDisclosure', () => {
  it('unfolds in place when no detail page is offered', () => {
    const onToggle = vi.fn();
    const row = checkRowDisclosure({ expanded: true, onToggle });

    expect(row.activate).toBe(onToggle);
    expect(row.ariaExpanded).toBe(true);
    expect(row.open).toBe(true);
  });

  it('opens the detail page instead of unfolding', () => {
    const onOpenDetail = vi.fn();
    const onToggle = vi.fn();
    const row = checkRowDisclosure({ expanded: false, onOpenDetail, onToggle });

    expect(row.activate).toBe(onOpenDetail);
    expect(row.open).toBe(false);
  });

  it('keeps a navigating row folded even when it is marked expanded', () => {
    // Expand entries are seeded on a wide window and survive a resize down to
    // phone width, where the row navigates instead.
    const row = checkRowDisclosure({ expanded: true, onOpenDetail: vi.fn(), onToggle: vi.fn() });

    expect(row.open).toBe(false);
  });

  it('drops aria-expanded on a navigating row', () => {
    const row = checkRowDisclosure({ expanded: false, onOpenDetail: vi.fn(), onToggle: vi.fn() });

    expect(row.ariaExpanded).toBeUndefined();
  });
});

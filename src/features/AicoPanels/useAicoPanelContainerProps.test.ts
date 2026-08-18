import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useIsMobile } from '@/hooks/useIsMobile';

import { useAicoPanelContainerProps } from './useAicoPanelContainerProps';

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(),
}));

describe('useAicoPanelContainerProps', () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReset();
  });

  it('uses compact padding and hides page-level horizontal overflow on mobile', () => {
    vi.mocked(useIsMobile).mockReturnValue(true);

    const props = useAicoPanelContainerProps(1100);

    expect(props.maxWidth).toBe(1100);
    expect(props.paddingBlock).toBe('16px 32px');
    expect(props.paddingInline).toBe(12);
    expect(props.style.overflowX).toBe('hidden');
    expect(props.style.minWidth).toBe(0);
  });

  it('uses desktop padding when not mobile', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);

    const props = useAicoPanelContainerProps();

    expect(props.maxWidth).toBe(960);
    expect(props.paddingBlock).toBe('24px 48px');
    expect(props.paddingInline).toBe(24);
  });
});

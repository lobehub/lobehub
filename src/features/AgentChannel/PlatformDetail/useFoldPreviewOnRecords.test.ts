import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { ChannelTab } from './channelTabs';
import { useFoldPreviewOnRecords } from './useFoldPreviewOnRecords';

const setup = (initialOpen: boolean) =>
  renderHook(
    ({ tab }: { tab: ChannelTab }) => {
      const [open, setOpen] = useState(initialOpen);
      useFoldPreviewOnRecords(tab, open, setOpen);
      return { open, setOpen };
    },
    { initialProps: { tab: 'wake' as ChannelTab } },
  );

describe('useFoldPreviewOnRecords', () => {
  it('folds the preview on the records tab and restores it on leaving', () => {
    const { result, rerender } = setup(true);

    rerender({ tab: 'records' });
    expect(result.current.open).toBe(false);

    rerender({ tab: 'reply' });
    expect(result.current.open).toBe(true);
  });

  it('keeps a preview that was already folded folded', () => {
    const { result, rerender } = setup(false);

    rerender({ tab: 'records' });
    rerender({ tab: 'wake' });
    expect(result.current.open).toBe(false);
  });

  it('lets the preview be opened by hand on the records tab', () => {
    const { result, rerender } = setup(true);

    rerender({ tab: 'records' });
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
  });

  it('leaves the preview alone between settings tabs', () => {
    const { result, rerender } = setup(true);

    act(() => result.current.setOpen(false));
    rerender({ tab: 'reply' });
    expect(result.current.open).toBe(false);
  });
});

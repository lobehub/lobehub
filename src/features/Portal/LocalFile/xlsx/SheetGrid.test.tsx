/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SheetModel } from './model';
import SheetGrid from './SheetGrid';

describe('SheetGrid', () => {
  it('keeps frozen columns sticky with resolved inline offsets', () => {
    const sheet: SheetModel = {
      cols: [80, 90, 100],
      frozen: { cols: 2, rows: 0 },
      name: 'Frozen Columns',
      rowCount: 1,
      rows: [
        {
          cells: [
            { c: 1, s: {}, t: 'account' },
            { c: 2, s: {}, t: 'region' },
            { c: 3, s: {}, t: 'amount' },
          ],
          h: null,
          r: 1,
        },
      ],
      truncated: false,
    };

    render(<SheetGrid sheet={sheet} />);

    const firstFrozen = screen.getByText('account').closest('td')!;
    const secondFrozen = screen.getByText('region').closest('td')!;
    const scrollable = screen.getByText('amount').closest('td')!;

    expect(firstFrozen.style.position).toBe('sticky');
    expect(firstFrozen.style.insetInlineStart).toBe('46px');
    expect(secondFrozen.style.position).toBe('sticky');
    expect(secondFrozen.style.insetInlineStart).toBe('126px');
    expect(scrollable.style.position).toBe('');
  });
});

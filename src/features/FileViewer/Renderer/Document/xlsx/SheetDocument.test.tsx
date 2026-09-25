/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SheetOutline } from './classifySheet';
import type { CellModel } from './model';
import SheetDocument from './SheetDocument';

const cell = (c: number, t: string): CellModel => ({
  c,
  s: {},
  t,
});

describe('SheetDocument', () => {
  it('renders row extras when the final table column is empty', () => {
    const outline: SheetOutline = {
      bodyFontSize: 11,
      confidence: 1,
      mode: 'reflow',
      sections: [
        {
          blank: 0,
          body: [
            {
              cells: [cell(1, '9/15'), cell(2, '住宿')],
              extras: [cell(4, '确认码 HMTD')],
              kind: 'data',
            },
          ],
          header: [cell(1, '日期'), cell(2, '项目'), cell(3, '金额')],
          notes: [],
          title: null,
        },
      ],
      stats: { aside: 0, chrome: 0, kv: 0, note: 0, table: 1 },
      subtitle: null,
      title: null,
    };

    render(<SheetDocument outline={outline} />);

    expect(screen.getByText('确认码 HMTD')).toBeTruthy();
  });
});

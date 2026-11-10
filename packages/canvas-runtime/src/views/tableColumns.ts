import { formatValue } from '../format';

const WIDE_RANGES: [number, number][] = [
  [0x11_00, 0x11_5f],
  [0x2e_80, 0xa4_cf],
  [0xac_00, 0xd7_a3],
  [0xf9_00, 0xfa_ff],
  [0xfe_30, 0xfe_4f],
  [0xff_00, 0xff_60],
  [0xff_e0, 0xff_e6],
];

const isWideChar = (code: number) => WIDE_RANGES.some(([from, to]) => code >= from && code <= to);

export const textColumns = (text: string) => {
  let width = 0;
  for (const char of text) width += isWideChar(char.codePointAt(0)!) ? 2 : 1;
  return width;
};

// CJK can break between any two characters, so an auto-layout table squeezes a column of
// short labels down to one character per line. Text up to this width stays on one line.
const SHORT_TEXT_COLUMNS = 12;
const WRAPPING_COLUMN_MIN_WIDTH = 140;
const NO_WRAP = { style: { whiteSpace: 'nowrap' } } as const;

export const isShortText = (text: string) => textColumns(text) <= SHORT_TEXT_COLUMNS;

export interface CanvasTableColumn {
  align?: 'left' | 'right';
  format?: string;
  key: string;
  title?: string;
}

export const toTableColumns = (columns: CanvasTableColumn[], rows: Record<string, unknown>[]) =>
  columns.map((column) => {
    const render = (value: unknown) => formatValue(value, column.format);
    const cellsFit = rows.every((row) => isShortText(render(row[column.key])));
    return {
      align: column.align,
      dataIndex: column.key,
      key: column.key,
      minWidth: cellsFit ? undefined : WRAPPING_COLUMN_MIN_WIDTH,
      onCell: cellsFit ? () => NO_WRAP : undefined,
      onHeaderCell: isShortText(String(column.title ?? '')) ? () => NO_WRAP : undefined,
      render,
      title: column.title,
    };
  });

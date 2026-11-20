import { describe, expect, it } from 'vitest';

import { isShortText, textColumns, toTableColumns } from './tableColumns';

describe('textColumns', () => {
  it('counts CJK and full-width characters as two columns', () => {
    expect(textColumns('王五')).toBe(4);
    expect(textColumns('2026-10-05')).toBe(10);
    expect(textColumns('第 3 天')).toBe(7);
    expect(textColumns('（2 小时）')).toBe(10);
  });
});

describe('isShortText', () => {
  it('treats labels up to six CJK characters as short', () => {
    expect(isShortText('多人实时协作')).toBe(true);
    expect(isShortText('团队工作区：文档 + 数据库')).toBe(false);
  });
});

describe('toTableColumns', () => {
  const columns = toTableColumns(
    [
      { key: 'dim', title: '维度' },
      { key: 'note', title: '说明' },
    ],
    [
      { dim: '产品定位', note: '团队工作区：文档 + 数据库 + 任务 + AI，适合需要协作的团队' },
      { dim: '多人实时协作', note: '原生' },
    ],
  );
  const [label, note] = columns;

  it('keeps a column of short CJK labels on one line', () => {
    expect(label.onCell?.()).toEqual({ style: { whiteSpace: 'nowrap' } });
    expect(label.onHeaderCell?.()).toEqual({ style: { whiteSpace: 'nowrap' } });
    expect(label.minWidth).toBeUndefined();
  });

  it('lets a column with long text wrap, but not below a readable width', () => {
    expect(note.onCell).toBeUndefined();
    expect(note.minWidth).toBeGreaterThanOrEqual(120);
  });
});

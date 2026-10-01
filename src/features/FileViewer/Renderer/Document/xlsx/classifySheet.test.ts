import { describe, expect, it } from 'vitest';

import { classifySheet } from './classifySheet';
import type { CellModel, SheetModel } from './model';

const cell = (c: number, t: string, s: CellModel['s'] = {}, span?: number): CellModel => ({
  c,
  s: { h: 'left', ...s },
  t,
  ...(span ? { cs: span, rs: 1 } : {}),
});

const sheet = (rows: CellModel[][], colCount = 4): SheetModel => ({
  cols: Array.from({ length: colCount }, () => 80),
  frozen: null,
  name: 'Sheet1',
  rowCount: rows.length,
  rows: rows.map((cells, index) => ({ cells, h: null, r: index + 1 })),
  truncated: false,
});

const band = (t: string, s: CellModel['s'], colCount = 4) => [cell(1, t, s, colCount)];

describe('classifySheet', () => {
  it('reads a banded title, sections, header and total row', () => {
    const outline = classifySheet(
      sheet([
        band('旅行分账表', { b: 1, bg: '#2F5496', fs: 16 }),
        band('共同消费平摊', { bg: '#2F5496', fs: 10 }),
        band('共同消费', { b: 1, bg: '#D9E1F2', fs: 11 }),
        [
          cell(1, '日期', { b: 1, bg: '#4472C4' }),
          cell(2, '项目', { b: 1, bg: '#4472C4' }),
          cell(3, '金额', { b: 1, bg: '#4472C4' }),
        ],
        [cell(1, '5/31'), cell(2, '机票'), cell(3, '4502')],
        [
          cell(1, '合计', { b: 1, bg: '#D9E1F2' }),
          cell(2, '', { b: 1, bg: '#D9E1F2' }),
          cell(3, '4502', { b: 1, bg: '#D9E1F2' }),
        ],
      ]),
    );

    expect(outline.title?.t).toBe('旅行分账表');
    expect(outline.subtitle?.t).toBe('共同消费平摊');
    expect(outline.sections).toHaveLength(1);
    expect(outline.sections[0].header?.map((item) => item.t)).toEqual(['日期', '项目', '金额']);
    expect(outline.sections[0].body.map((item) => item.kind)).toEqual(['data', 'total']);
    expect(outline.stats.aside).toBe(0);
    expect(outline.mode).toBe('reflow');
  });

  it('treats repeated top-size bands as sections instead of a document title', () => {
    const outline = classifySheet(
      sheet([
        band('紧急联系', { b: 1, fs: 14 }),
        [cell(1, '项目', { b: 1, bg: '#1F4E78' }), cell(2, '号码', { b: 1, bg: '#1F4E78' })],
        [cell(1, '警察'), cell(2, '110')],
        band('支付建议', { b: 1, fs: 14 }),
        [cell(1, '场景', { b: 1, bg: '#1F4E78' }), cell(2, '方式', { b: 1, bg: '#1F4E78' })],
        [cell(1, '餐厅'), cell(2, '刷卡')],
      ]),
    );

    expect(outline.title).toBeNull();
    expect(outline.sections.map((item) => item.title)).toEqual(['紧急联系', '支付建议']);
    expect(outline.sections.every((item) => item.header !== null)).toBe(true);
  });

  it('keeps a header whose data rows only fill the first column', () => {
    const outline = classifySheet(
      sheet([
        band('个人支出', { b: 1, bg: '#EAF1FD', fs: 11 }),
        [
          cell(1, '#', { b: 1, bg: '#1F6FEB' }),
          cell(2, '日期', { b: 1, bg: '#1F6FEB' }),
          cell(3, '金额', { b: 1, bg: '#1F6FEB' }),
        ],
        [cell(1, '1')],
        [cell(1, '2')],
      ]),
    );

    expect(outline.sections[0].header).not.toBeNull();
    expect(outline.stats.table).toBe(2);
  });

  it('keeps cells outside the header columns as row extras', () => {
    const outline = classifySheet(
      sheet(
        [
          [
            cell(1, '日期', { b: 1, bg: '#4472C4' }),
            cell(2, '项目', { b: 1, bg: '#4472C4' }),
            cell(3, '金额', { b: 1, bg: '#4472C4' }),
          ],
          [cell(1, '9/15'), cell(2, '住宿'), cell(3, '346'), cell(5, '确认码 HMTD', { fs: 9 })],
        ],
        5,
      ),
    );

    const [row] = outline.sections[0].body;
    expect(row.kind).toBe('data');
    expect(row.kind !== 'kv' && row.extras.map((item) => item.t)).toEqual(['确认码 HMTD']);
    expect(outline.stats.aside).toBe(0);
  });

  it('does not classify filled data rows as totals without a total marker', () => {
    const outline = classifySheet(
      sheet([
        [
          cell(1, '日期', { b: 1, bg: '#4472C4' }),
          cell(2, '项目', { b: 1, bg: '#4472C4' }),
          cell(3, '金额', { b: 1, bg: '#4472C4' }),
        ],
        [
          cell(1, '9/15', { bg: '#EAF1FD' }),
          cell(2, '住宿', { bg: '#EAF1FD' }),
          cell(3, '346', { bg: '#EAF1FD' }),
        ],
      ]),
    );

    expect(outline.sections[0].body[0].kind).toBe('data');
  });

  it('falls back to the fidelity grid when no structure is recognised', () => {
    const outline = classifySheet(
      sheet([
        [cell(1, '两个人：', { b: 1 }), cell(2, '11', { b: 1, bg: '#FFF2CC' })],
        [cell(1, '汇率：', { b: 1 }), cell(2, '5.28', { b: 1, bg: '#FFF2CC' })],
      ]),
    );

    expect(outline.sections[0].header).toBeNull();
    expect(outline.stats.kv).toBe(2);
    expect(outline.confidence).toBeLessThan(0.7);
    expect(outline.mode).toBe('fidelity');
  });
});

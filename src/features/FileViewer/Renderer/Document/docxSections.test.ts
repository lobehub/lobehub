// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { collectDocxSections } from './docxSections';

const render = (html: string): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
};

// Mirrors docx-preview's real output: the run's size and weight live on the
// inner span while the paragraph keeps the body default.
const para = (text: string, size: number, bold = false) =>
  `<p style="font-size:14px;font-weight:400"><span style="font-size:${size}px;font-weight:${bold ? 700 : 400}">${text}</span></p>`;

describe('collectDocxSections', () => {
  it('uses semantic headings when the file has them', () => {
    const root = render('<h1>Title</h1><h2>Goals</h2><h2>Risks</h2>');

    expect(collectDocxSections(root).map((section) => section.title)).toEqual([
      'Title',
      'Goals',
      'Risks',
    ]);
  });

  it('infers sections from size and weight when no heading style exists', () => {
    const root = render(
      [
        para('东京七日精确时刻表', 24, true),
        para('+ 全场景兜底锦囊', 16, true),
        para('出发：5 月中下旬 (梅雨季前)，人数 1-2 人，大本营 Hyatt Centric Ginza', 11),
        para('Day 1 — 抵达 + 浅草夜游', 16, true),
        para('14:00 浦东起飞，东方/全日空/日航直飞 NRT，全程约 3 小时', 10),
        para('17:30 出关取行李，出站直走到京成 Skyliner 售票处取票', 10),
        para('详细时刻表', 13, true),
        para('Day 2 — 新海诚三部曲', 16, true),
        para('09:00 从银座出发，丸之内线池袋方向，注意不要坐反', 10),
      ].join(''),
    );

    // The masthead (title + subtitle) precedes the first body line and is not
    // a section; the sub-label is a smaller tier than the day headings.
    expect(collectDocxSections(root).map((section) => section.title)).toEqual([
      'Day 1 — 抵达 + 浅草夜游',
      'Day 2 — 新海诚三部曲',
    ]);
  });

  it('ignores bold runs that sit at body size', () => {
    const root = render(
      [para('Title', 24, true), para('body text here', 11), para('inline emphasis', 11, true)].join(
        '',
      ),
    );

    expect(collectDocxSections(root)).toEqual([]);
  });

  it('keeps only the largest heading tier', () => {
    const root = render(
      [
        para('body opener line', 11),
        para('Day 1', 16, true),
        para('详细时刻表', 13, true),
        para('09:00 出发前往浅草，银座线浅草方面', 11),
        para('Day 2', 16, true),
      ].join(''),
    );

    expect(collectDocxSections(root).map((section) => section.title)).toEqual(['Day 1', 'Day 2']);
  });

  it('returns nothing for an empty render', () => {
    expect(collectDocxSections(render(''))).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { donutLegendCategories, showsDonutTotal } from './donut';

describe('showsDonutTotal', () => {
  it('hides the center total for shares of a whole', () => {
    expect(showsDonutTotal({ unit: '%' })).toBe(false);
    expect(showsDonutTotal({ 'value-format': 'percent' })).toBe(false);
    expect(showsDonutTotal({ unit: '元' })).toBe(true);
  });
});

describe('donutLegendCategories', () => {
  it('names every slice in data order', () => {
    const rows = [
      { region: '华东', share: 45 },
      { region: '华南', share: 30 },
      { region: '华北', share: 25 },
    ];
    expect(donutLegendCategories(rows, 'region')).toEqual(['华东', '华南', '华北']);
    expect(donutLegendCategories(rows, undefined)).toEqual([]);
  });
});

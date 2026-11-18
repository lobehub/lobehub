import { describe, expect, it } from 'vitest';

import { LOBE_DEFAULT_MODEL_LIST } from './index';

describe('isOfficial model cards', () => {
  const officialCards = LOBE_DEFAULT_MODEL_LIST.filter((card) => card.isOfficial);

  it('carry a list price, since callers use them to price usage', () => {
    expect(
      officialCards.filter((card) => !card.pricing).map((c) => `${c.providerId}/${c.id}`),
    ).toEqual([]);
  });

  it('mark at most one card per model id and type', () => {
    const keys = officialCards.map((card) => `${card.type}:${card.id}`);
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
  });

  it("mark Meta's own Muse cards, the only vendor-priced listing of these models", () => {
    const official = officialCards.map((card) => `${card.providerId}/${card.id}`);
    expect(official).toEqual(
      expect.arrayContaining(['meta/muse-wonder-1.0', 'meta/muse-spark-1.3']),
    );
  });
});

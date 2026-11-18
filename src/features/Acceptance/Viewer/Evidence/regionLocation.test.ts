import { describe, expect, it } from 'vitest';

import { regionLocations } from './regionLocation';

const note = (key: number, evidenceId: string) => ({ evidenceId, key });

describe('regionLocations', () => {
  it('numbers each region within its own image, like the badge drawn on it', () => {
    expect(
      regionLocations([note(1, 'a'), note(2, 'b'), note(3, 'a'), note(4, 'b')], ['a', 'b']),
    ).toEqual([
      { image: 1, region: 1 },
      { image: 2, region: 1 },
      { image: 1, region: 2 },
      { image: 2, region: 2 },
    ]);
  });

  it('follows the evidence order for the image number, not the order regions were drawn', () => {
    expect(regionLocations([note(1, 'b'), note(2, 'a')], ['a', 'b'])).toEqual([
      { image: 2, region: 1 },
      { image: 1, region: 1 },
    ]);
  });

  it('keeps a region whose image is gone on image 0 rather than dropping the row', () => {
    expect(regionLocations([note(1, 'gone')], ['a'])).toEqual([{ image: 0, region: 1 }]);
  });
});

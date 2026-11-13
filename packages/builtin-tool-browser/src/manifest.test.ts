import { describe, expect, it } from 'vitest';

import { BrowserManifest } from './manifest';

describe('BrowserManifest', () => {
  // A `navigate` + `readPage` batch run concurrently reported the title of one
  // page and the text of another.
  it('runs every api in emission order within a tool batch', () => {
    const unordered = BrowserManifest.api.filter((api) => api.ordered !== true);

    expect(unordered.map((api) => api.name)).toEqual([]);
  });
});

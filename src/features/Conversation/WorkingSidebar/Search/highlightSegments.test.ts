import { describe, expect, it } from 'vitest';

import { splitHighlightSegments } from './highlightSegments';

describe('splitHighlightSegments', () => {
  it('marks every case-insensitive occurrence and keeps the original casing', () => {
    expect(splitHighlightSegments('Deploy, then deploy', 'DEPLOY')).toEqual([
      { match: true, text: 'Deploy' },
      { match: false, text: ', then ' },
      { match: true, text: 'deploy' },
    ]);
  });

  it('returns the text untouched for a blank keyword or no match', () => {
    expect(splitHighlightSegments('hello', '  ')).toEqual([{ match: false, text: 'hello' }]);
    expect(splitHighlightSegments('hello', 'bye')).toEqual([{ match: false, text: 'hello' }]);
  });
});

import { describe, expect, it } from 'vitest';

import { splitQueryHighlightSegments } from './highlightSegments';

describe('splitQueryHighlightSegments', () => {
  it('returns the whole text unmarked for an empty query', () => {
    expect(splitQueryHighlightSegments('Kestrel notes', '  ')).toEqual([
      { match: false, text: 'Kestrel notes' },
    ]);
  });

  it('marks every case-insensitive occurrence of each term', () => {
    expect(
      splitQueryHighlightSegments('Kestrel and falcon, then kestrel', 'kestrel Falcon'),
    ).toEqual([
      { match: true, text: 'Kestrel' },
      { match: false, text: ' and ' },
      { match: true, text: 'falcon' },
      { match: false, text: ', then ' },
      { match: true, text: 'kestrel' },
    ]);
  });

  it('prefers the longer term where terms overlap', () => {
    expect(splitQueryHighlightSegments('kestrels', 'kestrel kestrels')).toEqual([
      { match: true, text: 'kestrels' },
    ]);
  });

  it('treats regular expression characters literally', () => {
    expect(splitQueryHighlightSegments('cost (usd) a.b', '(usd) a.b')).toEqual([
      { match: false, text: 'cost ' },
      { match: true, text: '(usd)' },
      { match: false, text: ' ' },
      { match: true, text: 'a.b' },
    ]);
  });

  it('matches CJK text', () => {
    expect(splitQueryHighlightSegments('这里讲机器学习的基础', '机器学习')).toEqual([
      { match: false, text: '这里讲' },
      { match: true, text: '机器学习' },
      { match: false, text: '的基础' },
    ]);
  });
});

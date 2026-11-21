import { describe, expect, it } from 'vitest';

import { findKeywordRanges } from './conversationHighlights';

const render = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
};

describe('findKeywordRanges', () => {
  it('finds every case-insensitive occurrence across text nodes', () => {
    const root = render('<p>Deploy now</p><p>then <b>deploy</b> again</p>');

    expect(findKeywordRanges(root, 'deploy').map((range) => range.toString())).toEqual([
      'Deploy',
      'deploy',
    ]);
  });

  it('skips editable and form text', () => {
    const root = render(
      '<textarea>deploy</textarea><div contenteditable="true">deploy</div><span>deploy</span>',
    );

    expect(findKeywordRanges(root, 'deploy')).toHaveLength(1);
  });

  it('finds nothing for a blank keyword', () => {
    expect(findKeywordRanges(render('<p>deploy</p>'), '  ')).toEqual([]);
  });
});

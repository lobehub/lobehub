import { describe, expect, it } from 'vitest';

import { findMalformedLiteXML } from '../liteXMLWellFormed';

describe('findMalformedLiteXML', () => {
  it('accepts well-formed fragments, including bare URLs and self-closing tags', () => {
    expect(
      findMalformedLiteXML('<p><span>see https://api.deepseek.com/v1</span></p>'),
    ).toBeUndefined();
    expect(findMalformedLiteXML('<p>a<br/>b</p><p>P&amp;L &lt;model&gt;</p>')).toBeUndefined();
    expect(findMalformedLiteXML(['<p id="ab">x</p>', '<li id="cd">y</li>'])).toBeUndefined();
  });

  it('names a raw tag-like word in the text that is never closed', () => {
    expect(findMalformedLiteXML('<ol><li>run lh provider test -m <model> now</li></ol>')).toContain(
      '<model> is never closed',
    );
    expect(findMalformedLiteXML('<p>a List<string> field</p>')).toContain(
      '<string> is never closed',
    );
  });

  it('reports a tag that is opened but never finished with ">"', () => {
    expect(findMalformedLiteXML('<p>a <b c</p>')).toContain(
      '"<b c" starts a tag that is never closed',
    );
  });

  it('accepts a raw "<" or "&" the parser reads as text', () => {
    for (const text of ['1 <2 and 3', 'if a < b then', 'x << y', 'A & B < C']) {
      expect(findMalformedLiteXML(`<p>${text}</p>`)).toBeUndefined();
    }
  });

  it('reports a closing tag without an opening tag', () => {
    expect(findMalformedLiteXML('<p>x</span></p>')).toContain(
      '</span> has no matching opening tag',
    );
  });

  it('tells the caller how to write the text instead', () => {
    expect(findMalformedLiteXML('<p>-m <model></p>')).toContain('"&lt;"');
  });

  it('checks every fragment of a multi-fragment modify', () => {
    expect(findMalformedLiteXML(['<p id="ab">ok</p>', '<p id="cd">a < b c</p>'])).toBeUndefined();
    expect(findMalformedLiteXML(['<p id="ab">ok</p>', '<p id="cd">-m <model></p>'])).toContain(
      '<model>',
    );
  });
});

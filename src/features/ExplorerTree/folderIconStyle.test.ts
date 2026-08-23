import { describe, expect, it } from 'vitest';

import { getExplorerTreeIconCSS, getExplorerTreeStyleVars } from './folderIconStyle';

describe('getExplorerTreeIconCSS', () => {
  it('maps ico files to the image icon', () => {
    const css = getExplorerTreeIconCSS('https://example.com/icons');
    const icoImageRule = new RegExp(
      String.raw`\[data-item-type="file"\]\[data-item-path\$="\.ico" i\]` +
        String.raw`[\S\s]*?background-image: url\("https:\/\/example\.com\/icons\/image\.svg"\)`,
    );

    expect(css).toMatch(icoImageRule);
  });
});

describe('getExplorerTreeStyleVars', () => {
  it('reserves the chevron column from pierre defaults when no metrics are given', () => {
    expect(getExplorerTreeStyleVars({ reserveChevronSlot: true })).toEqual({
      '--explorer-file-icon-offset': '22px',
    });
  });

  it('widens the reserved offset for trees that widen the icon gap', () => {
    // The document tree runs a 8px row gap, so files must clear 16 + 8.
    expect(
      getExplorerTreeStyleVars({ iconWidth: 16, reserveChevronSlot: true, rowGap: 8 }),
    ).toEqual({ '--explorer-file-icon-offset': '24px' });
  });

  it('claims no offset when the tree has no folders', () => {
    expect(getExplorerTreeStyleVars({ reserveChevronSlot: false, rowGap: 8 })).toEqual({
      '--explorer-file-icon-offset': '0px',
    });
  });
});

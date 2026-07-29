import { describe, expect, it } from 'vitest';

import { getExplorerTreeIconCSS } from './folderIconStyle';

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

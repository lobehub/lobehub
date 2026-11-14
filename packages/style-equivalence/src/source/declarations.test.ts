import { describe, expect, it } from 'vitest';

import { declarationText } from './declarations';

const site = (code: string, symbol: string, member: string) => ({
  code,
  css: false,
  kind: 'source' as const,
  member,
  path: 'a.tsx',
  symbol,
});

describe('declarationText', () => {
  it('reads a member of a style factory', () => {
    const code = `const styles = createStaticStyles(({ css }) => ({ item: css\`width: 1px;\` }));`;
    expect(declarationText(site(code, 'styles', 'item'))).toBe('item: css`width: 1px;`');
  });

  it('reads a standalone css constant as its own slot', () => {
    const code = `import { css, cx } from '@lobehub/ui';
const hotArea = css\`width: 32px;\`;
const ghost = cx(css\`opacity: 0.5;\`);
`;
    expect(declarationText(site(code, 'hotArea', 'hotArea'))).toBe('hotArea = css`width: 32px;`');
    expect(declarationText(site(code, 'ghost', 'ghost'))).toBe('ghost = cx(css`opacity: 0.5;`)');
  });
});

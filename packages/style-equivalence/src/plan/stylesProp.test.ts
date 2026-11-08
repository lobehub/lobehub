import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { generateModule } from '../generate/module';
import { planFile } from './planFile';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: [] };

const base = `import { controlHeight, createStaticStyles, Segmented } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  filterItem: css\`height: \${controlHeight.small}px;\`,
}));

export const Filters = () => <Segmented classNames={{ item: styles.filterItem }} size={'small'} />;
`;

const head = (prop: string) => `import { controlHeight, Segmented } from '@lobehub/ui';

const segmentedStyles = { item: { height: controlHeight.small } };

export const Filters = () => <Segmented size={'small'} styles={${prop}} />;
`;

const plan = (after: string) => {
  const pair = {
    base: extractFile(base, 'a.tsx', options),
    head: extractFile(after, 'a.tsx', options),
  };
  const result = planFile('a.tsx', pair.base, pair.head, { layoutComponents: [] });
  return { module: generateModule(pair.head, result, 'head', { layoutComponents: [] }), result };
};

describe("a component's styles prop", () => {
  it('pairs with the classNames slot it replaces and renders the slot style', () => {
    const { module, result } = plan(head('segmentedStyles'));
    expect(result.unpaired).toEqual([]);
    expect(result.cases.map((entry) => entry.elementIds)).toEqual([
      { base: 'Filters#0', head: 'Filters#0' },
    ]);
    expect(module).toContain('const segmentedStyles = { item: { height: controlHeight.small } };');
    expect(module).toContain('__neutral("styles", segmentedStyles)');
    expect(module).toContain('style={value as any}');
  });

  it('accepts an inline object of slot styles', () => {
    const { result } = plan(head('{ item: { height: controlHeight.small } }'));
    expect(result.unpaired).toEqual([]);
  });
});

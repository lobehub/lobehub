import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from './adapters/emotionStatic';
import { stylexAdapter } from './adapters/stylex';
import { extractFile } from './index';

const options = {
  adapters: [emotionStaticAdapter, stylexAdapter],
  layoutComponents: ['Flexbox'],
};

const base = `import { createStaticStyles, cx, Flexbox } from '@lobehub/ui';
import { Spin } from '@lobehub/ui';
import { useStore } from '@/store/home';

const indicator = <Spin size={9} />;

const styles = createStaticStyles(({ css }) => ({
  item: css\`height: 40px;\`,
  itemDragging: css\`opacity: 0;\`,
}));

export const SortableItem = memo(({ isDragging }) => {
  const store = useStore();
  return (
    <Flexbox horizontal gap={8} className={isDragging ? cx(styles.item, styles.itemDragging) : styles.item}>
      {store.name}
    </Flexbox>
  );
});
`;

const head = `import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  item: { height: '40px' },
  itemDragging: { opacity: 0 },
});

export const SortableItem = memo(({ isDragging }) => (
  <Flexbox horizontal gap={8} className={isDragging ? stylex.props(styles.item, styles.itemDragging).className : stylex.props(styles.item).className}>
    x
  </Flexbox>
));
`;

describe('extractFile', () => {
  it('finds the same element and condition variable on both sides of a cx → stylex.props migration', () => {
    const before = extractFile(base, 'a.tsx', options);
    const after = extractFile(head, 'a.tsx', options);
    expect(before.styleSymbols).toEqual(['styles']);
    expect(after.styleSymbols).toEqual(['styles']);
    for (const result of [before, after]) {
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0]).toMatchObject({
        id: 'SortableItem#0',
        literalProps: { gap: 8, horizontal: true },
        owner: 'SortableItem',
        slots: ['styles.item', 'styles.itemDragging'],
        tag: 'Flexbox',
        variables: [{ kind: 'boolean', name: 'isDragging' }],
      });
    }
  });

  it('keeps only the style declaration closure in the prelude', () => {
    const { prelude } = extractFile(base, 'a.tsx', options);
    expect(prelude).toContain("import { createStaticStyles, cx, Flexbox } from '@lobehub/ui';");
    expect(prelude).toContain('const styles = createStaticStyles(');
    expect(prelude).not.toContain('useStore');
    expect(prelude).not.toContain('indicator');
  });

  it('imports the stylex namespace when the styles come from another module', () => {
    const code = `import * as stylex from '@stylexjs/stylex';
import { styles } from './a.styles';
export const A = () => <span {...stylex.props(styles.a)} />;
`;
    expect(extractFile(code, 'a.tsx', options).prelude).toContain(
      "import * as stylex from '@stylexjs/stylex';",
    );
  });

  it('imports JSX tags used by a kept top-level statement', () => {
    const code = `import { Spin } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
const spinner = <Spin size={9} />;
const styles = stylex.create({ a: { color: 'red' } });
const tokens = { spinner };
export const A = () => <span {...stylex.props(styles.a)} data-x={tokens} />;
`;
    const { prelude } = extractFile(code, 'a.tsx', options);
    expect(prelude).not.toContain('Spin');
    const kept = extractFile(
      code.replace("{ a: { color: 'red' } }", "{ a: { color: 'red', content: String(spinner) } }"),
      'a.tsx',
      options,
    ).prelude;
    expect(kept).toContain("import { Spin } from '@lobehub/ui';");
    expect(kept).toContain('const spinner = <Spin size={9} />;');
  });

  it('binds JSX passed as a prop value to its own element, parented to the outer parent', () => {
    const code = `import * as stylex from '@stylexjs/stylex';
const styles = stylex.create({ row: { display: 'flex' }, wrapper: { position: 'relative' } });
export const Row = ({ isLoading, avatarNode }) => (
  <div {...stylex.props(styles.row)}>
    <Item avatar={isLoading ? <span {...stylex.props(styles.wrapper)}>{avatarNode}</span> : avatarNode} />
  </div>
);
`;
    const { elements } = extractFile(code, 'a.tsx', options);
    expect(elements.map((element) => [element.id, element.tag, element.parent])).toEqual([
      ['Row#0', 'div', undefined],
      ['Row#1', 'span', 'Row#0'],
    ]);
  });

  it('classifies how each free variable is used', () => {
    const code = `import * as stylex from '@stylexjs/stylex';
const styles = stylex.create({ a: { color: 'red' }, b: { color: 'blue' }, c: { color: 'green' } });
export const A = ({ isActive, item, visible, className }) => (
  <div {...stylex.props(styles.a, isActive() && styles.b, item.done && styles.c, !visible && styles.b)} className={className} />
);
`;
    const [element] = extractFile(code, 'a.tsx', options).elements;
    expect(element.variables).toEqual([
      { kind: 'call', name: 'isActive' },
      { kind: 'member', name: 'item' },
      { kind: 'boolean', name: 'visible' },
    ]);
  });

  it('reports style references outside JSX but not object keys or attribute names', () => {
    const code = `import { createStaticStyles } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({ a: css\`color: red;\` }));
const columns = [{ className: styles.a }];
export const open = () => createModal({ styles: { content: {} } });
export const A = () => <Modal styles={{ body: {} }} className={styles.a} />;
`;
    expect(extractFile(code, 'a.tsx', options).outsideReferences).toEqual(['styles@3']);
  });
});

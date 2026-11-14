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
    expect(before.prelude).toContain(
      "import { createStaticStyles, cx, Flexbox } from '@lobehub/ui';",
    );
    expect(before.prelude).toContain('const styles = createStaticStyles(');
    expect(before.prelude).not.toContain('useStore');
    expect(before.prelude).not.toContain('indicator');
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

  it('binds a spread of a local const that holds stylex.props', () => {
    const code = `import * as stylex from '@stylexjs/stylex';
const styles = stylex.create({ video: { maxHeight: '360px' }, flat: { width: '100%' } });
export const Item = ({ flat }: { flat?: boolean }) => {
  const videoProps = stylex.props(styles.video, flat && styles.flat);
  return <video controls {...videoProps} />;
};
`;
    const { elements } = extractFile(code, 'a.tsx', options);
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      bindings: [
        { expr: 'stylex.props(styles.video, flat && styles.flat)', prop: '...', spread: true },
      ],
      slots: ['styles.flat', 'styles.video'],
      tag: 'video',
      variables: [{ kind: 'boolean', name: 'flat' }],
    });
  });

  it('leaves a spread of an unrelated local const alone', () => {
    const code = `import * as stylex from '@stylexjs/stylex';
const styles = stylex.create({ a: { color: 'red' } });
export const Item = () => {
  const rest = { title: 'x' };
  return <span {...rest} {...stylex.props(styles.a)} />;
};
`;
    const { elements } = extractFile(code, 'a.tsx', options);
    expect(elements[0].bindings).toEqual([
      { expr: 'stylex.props(styles.a)', prop: '...', spread: true },
    ]);
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

  it('treats styles imported from a sibling style module as style symbols', () => {
    const modules: Record<string, string> = {
      './style': `import { createStaticStyles } from '@lobehub/ui';
export const styles = createStaticStyles(({ css }) => ({ box: css\`padding: 4px; .foreign { color: red; }\` }));
`,
      './A.styles': `import * as stylex from '@stylexjs/stylex';
export const atomic = stylex.create({ box: { padding: 4 } });
`,
    };
    const code = `import * as stylex from '@stylexjs/stylex';
import { atomic } from './A.styles';
import { styles } from './style';
export const A = () => <div className={styles.box}><span {...stylex.props(atomic.box)} /></div>;
`;
    const result = extractFile(code, 'src/A.tsx', {
      ...options,
      readModule: (_from, specifier) => modules[specifier],
    });
    expect(result.elements.map((element) => [element.id, element.slots])).toEqual([
      ['A#0', ['styles.box']],
      ['A#1', ['atomic.box']],
    ]);
    expect(result.prelude).toContain("import { styles } from './style';");
    expect(result.elements[0].flags).toEqual(['CROSS_COMPONENT']);
  });

  it('takes only the accessed member of an imported style object', () => {
    const modules: Record<string, string> = {
      './Card': `import * as stylex from '@stylexjs/stylex';
const mediaStyles = stylex.create({ image: { width: '100%' }, video: { display: 'block' } });
export const media = {
  image: { classNames: { image: stylex.props(mediaStyles.image).className } },
  video: mediaStyles.video,
};
`,
    };
    const code = `import { media } from './Card';
export const A = ({ flat }) => <Image {...(flat ? media.image : { variant: 'outlined' })} />;
`;
    const [element] = extractFile(code, 'src/A.tsx', {
      ...options,
      readModule: (_from, specifier) => modules[specifier],
    }).elements;
    expect(element.slots).toEqual(['media$mediaStyles.image']);
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

describe('extractFile selector ownership', () => {
  const source = (child: string) => `import { createStaticStyles, cx } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  header: css\`
    &:hover .${child} { color: red; }
  \`,
  label: css\`font-size: 12px;\`,
}));

export const Header = ({ title }) => (
  <button className={styles.header}>
    <span className={cx(styles.label, 'header-label')}>{title}</span>
  </button>
);
`;

  it('treats a class the same file puts on its own element as local, not cross-component', () => {
    const result = extractFile(source('header-label'), 'a.tsx', options);
    expect(result.elements.flatMap((element) => element.flags)).toEqual([]);
  });

  it('flags a descendant class the file never renders as cross-component', () => {
    const result = extractFile(source('ant-btn'), 'a.tsx', options);
    expect(result.elements.find((element) => element.id === 'Header#0')?.flags).toEqual([
      'CROSS_COMPONENT',
    ]);
  });
});

describe('extractFile variable modeling', () => {
  const kindsOf = (body: string, imports = '') => {
    const code = `import * as stylex from '@stylexjs/stylex';
${imports}
const styles = stylex.create({ a: { color: 'red' }, b: { color: 'blue' }, c: { color: 'green' } });
${body}
`;
    const result = extractFile(code, 'a.tsx', options);
    return { prelude: result.prelude, variables: result.elements[0].variables };
  };

  it('models a parameter that shadows an import instead of pulling the import in', () => {
    const { prelude, variables } = kindsOf(
      'export const A = ({ active }) => <div {...stylex.props(styles.a, active && styles.b)} />;',
      "import { active } from '@/store/chat/selectors';",
    );
    expect(variables).toEqual([{ kind: 'boolean', name: 'active' }]);
    expect(prelude).not.toContain('@/store/chat/selectors');
  });

  it('does not model a member compared with a literal', () => {
    const { variables } = kindsOf(
      "export const A = ({ state }) => <div {...stylex.props(styles.a, state.kind === 'off' && styles.b)} />;",
    );
    expect(variables).toEqual([{ kind: 'unknown', name: 'state' }]);
  });

  it('does not model a value used both as a boolean and as an object', () => {
    const { variables } = kindsOf(
      'export const A = ({ item }) => <div {...stylex.props(styles.a, item && styles.b, item.done && styles.c)} />;',
    );
    expect(variables).toEqual([{ kind: 'unknown', name: 'item' }]);
  });
});

describe('extractFile slot properties', () => {
  it('records the properties each Emotion slot sets, including nested rules and conditions', () => {
    const code = `import { createStaticStyles } from '@lobehub/ui';
const styles = createStaticStyles(({ css, cssVar }) => ({
  activated: css\`
    color: \${cssVar.colorSuccess};
    background: \${cssVar.colorSuccessBg};
  \`,
  listItem: css\`
    padding-block: 10px;
    &:not(:last-child) { border-block-end: 1px solid red; }
    @media (max-width: 600px) { font-size: 12px; }
  \`,
}));
export const A = () => <span className={styles.activated} />;
`;
    expect(extractFile(code, 'a.tsx', options).slotProperties).toEqual({
      'styles.activated': ['background', 'color'],
      'styles.listItem': ['border-block-end', 'font-size', 'padding-block'],
    });
  });

  it('leaves out an Emotion slot whose declarations it cannot read', () => {
    const code = `import { createStaticStyles } from '@lobehub/ui';
const styles = createStaticStyles(({ css }) => ({
  mixed: css\`
    \${mixin}
    color: red;
  \`,
  computed: css\`
    \${side}: 0;
  \`,
  plain: css\`color: red;\`,
}));
export const A = () => <span className={styles.plain} />;
`;
    expect(extractFile(code, 'a.tsx', options).slotProperties).toEqual({
      'styles.plain': ['color'],
    });
  });

  it('records the properties each StyleX slot sets as kebab-case names', () => {
    const code = `import * as stylex from '@stylexjs/stylex';
const styles = stylex.create({
  activated: { color: 'green', backgroundColor: 'white', backgroundImage: 'none' },
  dot: { borderWidth: { default: null, ':hover': '1px' }, '::placeholder': { color: 'gray' } },
  dynamic: (size) => ({ width: size, WebkitLineClamp: 2 }),
  spread: { ...base, color: 'red' },
  vars: { '--accent': 'red' },
});
export const A = () => <span {...stylex.props(styles.activated)} />;
`;
    expect(extractFile(code, 'a.tsx', options).slotProperties).toEqual({
      'styles.activated': ['background-color', 'background-image', 'color'],
      'styles.dot': ['border-width', 'color'],
      'styles.dynamic': ['-webkit-line-clamp', 'width'],
      'styles.vars': ['--accent'],
    });
  });
});

describe('extractFile standalone css constants', () => {
  const code = `import { css, cssVar, cx } from '@lobehub/ui';

const hotArea = css\`
  width: 32px;

  &:hover {
    color: \${cssVar.colorText};
  }
\`;
const ghost = cx(css\`opacity: 0.5;\`);

export const Upload = () => (
  <div className={cx(hotArea)}>
    <span className={ghost} />
  </div>
);
`;

  it('treats a module-level css template as a style slot of its own name', () => {
    const extraction = extractFile(code, 'a.tsx', options);

    expect(extraction.elements.map(({ id, slots }) => ({ id, slots }))).toEqual([
      { id: 'Upload#0', slots: ['hotArea.hotArea'] },
      { id: 'Upload#1', slots: ['ghost.ghost'] },
    ]);
    expect(
      extraction.rules
        .filter((rule) => rule.slot === 'hotArea.hotArea')
        .map(({ declarations, selector }) => ({ declarations, selector })),
    ).toEqual([{ declarations: ['color: __I0__'], selector: '.__self__:hover' }]);
    expect(extraction.slotProperties?.['hotArea.hotArea']).toEqual(['color', 'width']);
  });

  it('keeps the constant and its imports in the prelude so the binding renders', () => {
    const { prelude } = extractFile(code, 'a.tsx', options);

    expect(prelude).toContain("import { css, cssVar, cx } from '@lobehub/ui';");
    expect(prelude).toContain('const hotArea = css`');
    expect(prelude).toContain('const ghost = cx(css`opacity: 0.5;`);');
  });

  it('ignores a css template whose tag is not imported from a style library', () => {
    const local = `const css = (parts) => parts.join('');
const hotArea = css\`width: 32px;\`;
export const Upload = () => <div className={hotArea} />;
`;
    expect(extractFile(local, 'a.tsx', options).elements).toEqual([]);
  });
});

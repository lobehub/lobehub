import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { generateModule } from '../generate/module';
import { planFile } from './planFile';
import { type ComponentShape, type ShapeBook, shapeKey } from './shapes';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: ['Flexbox'] };

const buttonBase = (children = '<Button>a</Button><Button type="primary">b</Button>') => `
import { Button, createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  actions: css\`
    display: flex;

    > button {
      flex: 1;
      min-height: 44px;
    }
  \`,
}));

export const View = () => <div className={styles.actions}>${children}</div>;
`;

const buttonHead = (
  children = '<Button {...stylex.props(styles.actionButton)}>a</Button><Button type="primary" {...stylex.props(styles.actionButton)}>b</Button>',
) => `
import { Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  actions: { display: 'flex' },
  actionButton: { flex: '1', minHeight: '44px' },
});

export const View = () => <div {...stylex.props(styles.actions)}>${children}</div>;
`;

const imageBase = `
import { createStaticStyles, Image } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  thumb: css\`
    width: 56px;

    img {
      width: 100%;
      object-fit: cover;
    }
  \`,
}));

export const Thumb = ({ url }) => (
  <div className={styles.thumb}>
    <Image alt="" preview={false} src={url} />
  </div>
);
`;

const imageHead = `
import { Image } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  thumb: { width: '56px' },
  thumbImage: { width: '100%', objectFit: 'cover' },
});

export const Thumb = ({ url }) => (
  <div {...stylex.props(styles.thumb)}>
    <Image
      alt=""
      classNames={{ image: stylex.props(styles.thumbImage).className }}
      preview={false}
      src={url}
    />
  </div>
);
`;

const BUTTON = { imported: 'Button', source: '@lobehub/ui' };
const IMAGE = { imported: 'Image', source: '@lobehub/ui' };

const button: ComponentShape = {
  className: { path: [], tag: 'button' },
  root: 'button',
  slots: {},
  tags: ['button', 'span'],
};

const image: ComponentShape = {
  className: { path: [], tag: 'div' },
  root: 'div',
  slots: { image: { path: [0, 0], tag: 'img' } },
  tags: ['div', 'img'],
};

const both = (shape: ComponentShape, head: ComponentShape = shape) => ({ base: shape, head });

const buttonBook = (base = button, head = base): ShapeBook => ({
  [shapeKey(BUTTON, {})]: both(base, head),
  [shapeKey(BUTTON, { type: 'primary' })]: both(base, head),
});

const plan = (before: string, after: string, shapes?: ShapeBook) => {
  const pair = {
    base: extractFile(before, 'a.tsx', options),
    head: extractFile(after, 'a.tsx', options),
  };
  return {
    pair,
    result: planFile('a.tsx', pair.base, pair.head, { layoutComponents: ['Flexbox'], shapes }),
  };
};

describe('a component child paired through its learned shape', () => {
  it('records the import of a component tag and its non-style props', () => {
    const { pair } = plan(buttonBase('<Button icon={Pencil}>a</Button>'), buttonHead());
    expect(pair.base.plain?.[0]).toMatchObject({
      component: BUTTON,
      propTexts: ['icon={Pencil}'],
    });
    expect(pair.head.elements[1]).toMatchObject({ component: BUTTON });
    expect(pair.head.elements[1].propTexts).toBeUndefined();
  });

  it('leaves the children unpaired without a learned shape', () => {
    expect(plan(buttonBase(), buttonHead()).result.unpaired).toEqual([
      { elementId: 'View#1', side: 'head' },
      { elementId: 'View#2', side: 'head' },
    ]);
  });

  it('pairs a child step on the tag the component root renders and renders it for real', () => {
    const { result } = plan(buttonBase(), buttonHead(), buttonBook());
    expect(result.unpaired).toEqual([]);
    const child = result.cases.find((entry) => entry.key === 'a.tsx|View#0/0');
    expect(child?.elementIds).toEqual({ base: 'View#0/0', head: 'View#1' });
    expect(child?.flags).toEqual([]);
    expect(child?.evidence).toEqual([
      'DESCENDANT_REPLACED',
      'COMPONENT_SHAPE_LEARNED',
      'REAL_COMPONENT_RENDERED',
    ]);
    expect(child?.realElements).toEqual({ base: ['View#0/0'], head: ['View#1'] });
    expect(child?.standIns).toBeUndefined();
  });

  it('clears the parent once every child the rule reaches is rendered', () => {
    const parent = plan(buttonBase(), buttonHead(), buttonBook()).result.cases[0];
    expect(parent.key).toBe('a.tsx|View#0');
    expect(parent.flags).toEqual([]);
    expect(parent.evidence).toEqual(['DESCENDANT_RENDERED']);
  });

  it('renders the real component with an import on both sides', () => {
    const { pair, result } = plan(buttonBase(), buttonHead(), buttonBook());
    const config = { layoutComponents: ['Flexbox'] };
    const base = generateModule(pair.base, result, 'base', config);
    const head = generateModule(pair.head, result, 'head', config);
    expect(base).toContain('import { Button } from "@lobehub/ui";');
    expect(base).toContain(
      '<Button data-synthetic-element="View#0/1" data-synthetic-pair="View#0/1" type="primary">',
    );
    expect(head).toContain('import { Button } from "@lobehub/ui";');
    expect(head).toContain(
      '<Button data-synthetic-element="View#2" data-synthetic-pair="View#0/1" type="primary" {...(stylex.props(styles.actionButton))}>',
    );
  });

  it('imports a renamed component under its local name once', () => {
    const renamed = (source: string) =>
      source.replace(
        "import { Button } from '@lobehub/ui';",
        "import { Button as Btn } from '@lobehub/ui';",
      );
    const { pair, result } = plan(
      buttonBase()
        .replaceAll('<Button', '<Btn')
        .replaceAll('</Button>', '</Btn>')
        .replace(
          'import { Button, createStaticStyles }',
          'import { Button as Btn, createStaticStyles }',
        ),
      renamed(buttonHead().replaceAll('<Button', '<Btn').replaceAll('</Button>', '</Btn>')),
      buttonBook(),
    );
    expect(result.unpaired).toEqual([]);
    const head = generateModule(pair.head, result, 'head', { layoutComponents: ['Flexbox'] });
    expect(head.match(/import \{ Button as Btn \} from "@lobehub\/ui";/g)).toHaveLength(1);
  });

  it('keeps the stand-in pairing out when the root renders another tag', () => {
    const anchor = { ...button, className: { path: [], tag: 'a' }, root: 'a', tags: ['a'] };
    expect(plan(buttonBase(), buttonHead(), buttonBook(anchor)).result.unpaired).toHaveLength(2);
  });

  it('keeps a child step unpaired when the class lands below the root', () => {
    const inner = { ...button, className: { path: [0], tag: 'button' } };
    expect(
      plan(buttonBase(), buttonHead(), buttonBook(button, inner)).result.unpaired,
    ).toHaveLength(2);
  });

  it('keeps it unpaired when the two revisions render different roots', () => {
    const anchor = { ...button, className: { path: [], tag: 'a' }, root: 'a', tags: ['a'] };
    expect(
      plan(buttonBase(), buttonHead(), buttonBook(button, anchor)).result.unpaired,
    ).toHaveLength(2);
  });

  it('keeps it unpaired when the props it cannot render differ', () => {
    const { result } = plan(
      buttonBase('<Button icon={A}>a</Button>'),
      buttonHead('<Button icon={B} {...stylex.props(styles.actionButton)}>a</Button>'),
      buttonBook(),
    );
    expect(result.unpaired).toEqual([{ elementId: 'View#1', side: 'head' }]);
  });

  it('keeps it unpaired when the head spreads props it cannot read', () => {
    const { result } = plan(
      buttonBase('<Button>a</Button>'),
      buttonHead('<Button {...rest} {...stylex.props(styles.actionButton)}>a</Button>'),
      buttonBook(),
    );
    expect(result.unpaired).toEqual([{ elementId: 'View#1', side: 'head' }]);
  });

  it('pairs a descendant step on the element a classNames slot lands on', () => {
    const { pair, result } = plan(imageBase, imageHead, {
      [shapeKey(IMAGE, { alt: '', preview: false })]: both(image),
    });
    expect(result.unpaired).toEqual([]);
    const child = result.cases.find((entry) => entry.key === 'a.tsx|Thumb#0/0');
    expect(child?.flags).toEqual([]);
    expect(child?.realElements).toEqual({ base: ['Thumb#0/0'], head: ['Thumb#1'] });
    const head = generateModule(pair.head, result, 'head', { layoutComponents: ['Flexbox'] });
    expect(head).toContain('import { Image } from "@lobehub/ui";');
    expect(head).toContain('classNames={{ image: stylex.props(styles.thumbImage).className }}');
    expect(head).not.toContain('__neutral("classNames"');
  });

  it('renders a component that takes no children closed on both sides', () => {
    const { pair, result } = plan(imageBase, imageHead, {
      [shapeKey(IMAGE, { alt: '', preview: false })]: both({ ...image, leaf: true }),
    });
    const config = { layoutComponents: ['Flexbox'] };
    expect(generateModule(pair.base, result, 'base', config)).toContain(
      '<Image data-synthetic-element="Thumb#0/0" data-synthetic-pair="Thumb#0/0" alt="" preview={false} />',
    );
    expect(generateModule(pair.head, result, 'head', config)).toContain(
      '<Image data-synthetic-element="Thumb#1" data-synthetic-pair="Thumb#0/0" alt="" preview={false} classNames={{ image: stylex.props(styles.thumbImage).className }} />',
    );
  });

  it('keeps it unpaired when only one revision takes children', () => {
    const key = shapeKey(IMAGE, { alt: '', preview: false });
    expect(
      plan(imageBase, imageHead, { [key]: both(image, { ...image, leaf: true }) }).result.unpaired,
    ).toHaveLength(1);
  });

  it('keeps a slot unpaired when the slot was not learned or lands on another tag', () => {
    const key = shapeKey(IMAGE, { alt: '', preview: false });
    const missing = { ...image, slots: {} };
    const wrapper = { ...image, slots: { image: { path: [0], tag: 'div' } } };
    expect(plan(imageBase, imageHead, { [key]: both(missing) }).result.unpaired).toHaveLength(1);
    expect(plan(imageBase, imageHead, { [key]: both(wrapper) }).result.unpaired).toHaveLength(1);
  });
});

const wrapperBase = `
import { Button, createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  actions: css\`
    display: flex;

    > button {
      flex: none;
    }
  \`,
}));

export const Bar = ({ reason }) => (
  <div className={styles.actions}>
    <Button disabled title={reason} type="text">a</Button>
    <Button type="fill">b</Button>
  </div>
);
`;

const wrapperHead = (body = '<Button {...props} {...stylex.props(styles.actionButton)} />') => `
import type { ButtonProps } from '@lobehub/ui';
import { Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  actions: { display: 'flex' },
  actionButton: { flex: 'none' },
});

const ActionButton = (props: ButtonProps) => ${body};

export const Bar = ({ reason }) => (
  <div {...stylex.props(styles.actions)}>
    <ActionButton disabled title={reason} type="text">a</ActionButton>
    <ActionButton type="fill">b</ActionButton>
  </div>
);
`;

const wrapperBook: ShapeBook = {
  [shapeKey(BUTTON, { disabled: true, type: 'text' })]: both(button),
  [shapeKey(BUTTON, { type: 'fill' })]: both(button),
};

describe('a local wrapper that forwards every prop to a library component', () => {
  it('stays unpaired without a learned shape', () => {
    expect(plan(wrapperBase, wrapperHead()).result.unpaired).toEqual([
      { elementId: 'ActionButton#0', side: 'head' },
    ]);
  });

  it('pairs each usage with the child the parent rule reached and renders the wrapper', () => {
    const { pair, result } = plan(wrapperBase, wrapperHead(), wrapperBook);
    expect(result.unpaired).toEqual([]);
    const first = result.cases.find((entry) => entry.key === 'a.tsx|Bar#0/0');
    expect(first?.elementIds).toEqual({ base: 'Bar#0/0', head: 'Bar#0/0' });
    expect(first?.flags).toEqual([]);
    expect(first?.evidence).toEqual([
      'DESCENDANT_REPLACED',
      'COMPONENT_SHAPE_LEARNED',
      'REAL_COMPONENT_RENDERED',
    ]);
    expect(first?.realElements).toEqual({ base: ['Bar#0/0'], head: ['Bar#0/0'] });
    expect(result.cases[0].flags).toEqual([]);
    const head = generateModule(pair.head, result, 'head', { layoutComponents: ['Flexbox'] });
    expect(head).toContain('const ActionButton = (props: ButtonProps) =>');
    expect(head).toContain(
      '<ActionButton data-synthetic-element="Bar#0/0" data-synthetic-pair="Bar#0/0" disabled={true} type="text">',
    );
  });

  it('keeps the wrapper unpaired when it adds props of its own', () => {
    const { result } = plan(
      wrapperBase,
      wrapperHead('<Button {...props} size="small" {...stylex.props(styles.actionButton)} />'),
      wrapperBook,
    );
    expect(result.unpaired).toEqual([{ elementId: 'ActionButton#0', side: 'head' }]);
  });

  it('keeps the wrapper unpaired when the forwarded props come after its style', () => {
    const { result } = plan(
      wrapperBase,
      wrapperHead('<Button {...stylex.props(styles.actionButton)} {...props} />'),
      wrapperBook,
    );
    expect(result.unpaired).toEqual([{ elementId: 'ActionButton#0', side: 'head' }]);
  });
});

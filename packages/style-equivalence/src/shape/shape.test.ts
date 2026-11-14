import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchBrowser } from '../capture/browser';
import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { planFile } from '../plan/planFile';
import { shapeKey } from '../plan/shapes';
import { mergeWidths } from './book';
import { readShapesInPage } from './inPage';
import { generateProbeEntry, SHAPE_CLASS, SHAPE_SLOT_PREFIX } from './probe';
import { shapeRequests } from './requests';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: ['Flexbox'] };

const base = (source: string) => `
import { createStaticStyles } from '@lobehub/ui';
import { Button, Image } from '${source}';

const styles = createStaticStyles(({ css }) => ({
  row: css\`
    > button { flex: 1; }
    img { width: 100%; }
  \`,
}));

export const View = () => (
  <div className={styles.row}>
    <Button type="primary">a</Button>
    <Image alt="" />
  </div>
);
`;

const head = (source: string) => `
import * as stylex from '@stylexjs/stylex';
import { Button, Image } from '${source}';

const styles = stylex.create({
  row: {},
  button: { flex: '1' },
  image: { width: '100%' },
});

export const View = () => (
  <div {...stylex.props(styles.row)}>
    <Button type="primary" {...stylex.props(styles.button)}>a</Button>
    <Image alt="" classNames={{ image: stylex.props(styles.image).className }} />
  </div>
);
`;

const synthesis = (source: string) => {
  const pair = {
    base: extractFile(base(source), 'a.tsx', options),
    head: extractFile(head(source), 'a.tsx', options),
  };
  const plan = planFile('a.tsx', pair.base, pair.head, { layoutComponents: ['Flexbox'] });
  return { extractions: { 'a.tsx': pair }, plans: [plan] };
};

const BUTTON = { imported: 'Button', source: '@lobehub/ui' };
const IMAGE = { imported: 'Image', source: '@lobehub/ui' };

describe('the components whose shape a pairing needs', () => {
  it('requests each package component child with its props and the slots the head styles', () => {
    expect(shapeRequests(synthesis('@lobehub/ui'), { '@/': 'src/' })).toEqual([
      {
        component: BUTTON,
        key: shapeKey(BUTTON, { type: 'primary' }),
        props: { type: 'primary' },
        slots: [],
      },
      { component: IMAGE, key: shapeKey(IMAGE, { alt: '' }), props: { alt: '' }, slots: ['image'] },
    ]);
  });

  it('requests the library component a local wrapper forwards its usage to', () => {
    const wrapperHead = head('@lobehub/ui')
      .replace(
        'export const View',
        'const Primary = (props) => <Button {...props} {...stylex.props(styles.button)} />;\n\nexport const View',
      )
      .replace(
        '<Button type="primary" {...stylex.props(styles.button)}>a</Button>',
        '<Primary type="primary">a</Primary>',
      )
      .replace('classNames={{ image: stylex.props(styles.image).className }} ', '');
    const pair = {
      base: extractFile(base('@lobehub/ui'), 'a.tsx', options),
      head: extractFile(wrapperHead, 'a.tsx', options),
    };
    const plan = planFile('a.tsx', pair.base, pair.head, { layoutComponents: ['Flexbox'] });
    expect(plan.unpaired).toEqual([{ elementId: 'Primary#0', side: 'head' }]);
    expect(
      shapeRequests({ extractions: { 'a.tsx': pair }, plans: [plan] }, {}).map(
        (request) => request.key,
      ),
    ).toContain(shapeKey(BUTTON, { type: 'primary' }));
  });

  it('requests nothing for components from the project itself', () => {
    const aliases = { '@/': 'src/' };
    expect(shapeRequests(synthesis('./ui'), aliases)).toEqual([]);
    expect(shapeRequests(synthesis('@/ui'), aliases)).toEqual([]);
  });
});

describe('the probe page that renders each component once', () => {
  it('renders every request with marker classes under its key', () => {
    const entry = generateProbeEntry({
      hostWrapper: '/repo/host.tsx',
      requests: shapeRequests(synthesis('@lobehub/ui'), {}),
    });
    expect(entry).toContain('import { Host } from "/repo/host.tsx";');
    expect(entry).toContain('import { Button as __shape0 } from "@lobehub/ui";');
    expect(entry).toContain(
      `<__shape0 className="${SHAPE_CLASS}" type="primary">{"Ag 文本 Text"}</__shape0>`,
    );
    expect(entry).toContain(`classNames={{"image":"${SHAPE_SLOT_PREFIX}image"}}`);
    expect(entry).toContain(`data-shape-probe={${JSON.stringify(shapeKey(IMAGE, { alt: '' }))}}`);
    expect(entry).toContain(
      `<section data-shape-leaf="" data-shape-probe={${JSON.stringify(shapeKey(BUTTON, { type: 'primary' }))}}><Boundary><__shape0 className="${SHAPE_CLASS}" type="primary" /></Boundary></section>`,
    );
  });

  it('imports a default export under its probe name', () => {
    const entry = generateProbeEntry({
      hostWrapper: '/repo/host.tsx',
      requests: [
        { component: { imported: 'default', source: 'ui-kit' }, key: 'k', props: {}, slots: [] },
      ],
    });
    expect(entry).toContain('import __shape0 from "ui-kit";');
  });
});

describe('reading a rendered component shape', () => {
  let browser: Awaited<ReturnType<typeof launchBrowser>>;
  beforeAll(async () => {
    browser = await launchBrowser();
  });
  afterAll(() => browser?.close());

  it('records the root tag, where the class and each slot land, and the tags inside', async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <section data-shape-probe="button"><style></style><button class="${SHAPE_CLASS}"><span>a</span></button></section>
      <section data-shape-probe="image"><div class="${SHAPE_CLASS}"><div><img class="${SHAPE_SLOT_PREFIX}image"></div></div></section>
      <section data-shape-probe="portal"></section>
      <section data-shape-probe="twice"><b class="${SHAPE_CLASS}"><i class="${SHAPE_CLASS}"></i></b></section>
      <section data-shape-probe="broken"><div data-shape-error=""></div></section>
      <section data-shape-probe="void"><div data-shape-error=""></div></section>
      <section data-shape-leaf="" data-shape-probe="void"><img class="${SHAPE_CLASS}"></section>
      <section data-shape-leaf="" data-shape-probe="button"><button class="${SHAPE_CLASS}"></button></section>
    `);
    const shapes = await page.evaluate(readShapesInPage, {
      className: SHAPE_CLASS,
      slotPrefix: SHAPE_SLOT_PREFIX,
    });
    expect(shapes).toEqual({
      button: {
        className: { path: [], tag: 'button' },
        root: 'button',
        slots: {},
        tags: ['button', 'span'],
      },
      image: {
        className: { path: [], tag: 'div' },
        root: 'div',
        slots: { image: { path: [0, 0], tag: 'img' } },
        tags: ['div', 'img'],
      },
      twice: { root: 'b', slots: {}, tags: ['b', 'i'] },
      void: {
        className: { path: [], tag: 'img' },
        leaf: true,
        root: 'img',
        slots: {},
        tags: ['img'],
      },
    });
    await page.close();
  });
});

describe('a shape learned at several widths', () => {
  const shape = { root: 'button', slots: {}, tags: ['button'] };
  it('keeps a shape only when every width rendered it the same', () => {
    expect(
      mergeWidths([
        { a: shape, b: shape },
        { a: shape, b: { ...shape, root: 'a' } },
      ]),
    ).toEqual({
      a: shape,
    });
    expect(mergeWidths([{ a: shape }, {}])).toEqual({});
  });
});

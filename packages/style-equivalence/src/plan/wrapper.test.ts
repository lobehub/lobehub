import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { generateModule } from '../generate/module';
import { planFile } from './planFile';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: [] };

const base = `import { createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({ player: css\`width: 4px;\` }));

export const Player = ({ width }) => (
  <div style={{ maxWidth: width }}>
    <div className={styles.player} />
  </div>
);
`;

const head = `import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

const hostMarker = stylex.defineMarker();
const styles = stylex.create({ player: { width: '4px' } });

export const Player = ({ width }) => (
  <div {...sx([hostMarker], undefined, { maxWidth: width })}>
    <div {...stylex.props(styles.player)} />
  </div>
);
`;

describe('a wrapper that only carries a marker and an inline style', () => {
  it('pairs the styled child without the wrapper on either side', () => {
    const pair = {
      base: extractFile(base, 'a.tsx', options),
      head: extractFile(head, 'a.tsx', options),
    };
    expect(pair.head.elements.map((element) => element.id)).toEqual(['Player#0', 'Player#1']);
    const plan = planFile('a.tsx', pair.base, pair.head, { layoutComponents: [] });
    expect(plan.cases.map((entry) => entry.elementIds)).toEqual([
      { base: 'Player#0', head: 'Player#1' },
    ]);
    const module = generateModule(pair.head, plan, 'head', { layoutComponents: [] });
    const render = module.split('\n').find((line) => line.startsWith('"a.tsx|Player#0"'));
    expect(render).toContain('data-synthetic-element="Player#1"');
    expect(render).not.toContain('hostMarker');
  });

  it('leaves out a component ancestor whose className only adds a marker', () => {
    const before = `import { createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({ actions: css\`width: 4px;\` }));

export const Group = () => (
  <AccordionHeader className={'accordion-header'}>
    <span className={styles.actions} />
  </AccordionHeader>
);
`;
    const after = `import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

const headerMarker = stylex.defineMarker();
const styles = stylex.create({ actions: { width: '4px' } });

export const Group = () => (
  <AccordionHeader className={cx('accordion-header', stylex.props(headerMarker).className)}>
    <span {...stylex.props(styles.actions)} />
  </AccordionHeader>
);
`;
    const pair = {
      base: extractFile(before, 'a.tsx', options),
      head: extractFile(after, 'a.tsx', options),
    };
    expect(pair.head.elements.map((element) => element.tag)).toEqual(['AccordionHeader', 'span']);
    const plan = planFile('a.tsx', pair.base, pair.head, { layoutComponents: [] });
    const module = generateModule(pair.head, plan, 'head', { layoutComponents: [] });
    const render = module.split('\n').find((line) => line.startsWith('"a.tsx|Group#0"'));
    expect(render).toContain('data-synthetic-element="Group#1"');
    expect(render).not.toContain('data-synthetic-element="Group#0"');
  });

  it('keeps a marker-only ancestor that pairs with a styled one on the other side', () => {
    const before = `import { createStaticStyles } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  card: css\`padding: 4px;\`,
  toggle: css\`width: 4px;\`,
}));

export const Goal = () => (
  <div className={styles.card}>
    <span className={styles.toggle} />
  </div>
);
`;
    const after = `import * as stylex from '@stylexjs/stylex';

const cardMarker = stylex.defineMarker();
const styles = stylex.create({ toggle: { width: '4px' } });

export const Goal = () => (
  <div {...stylex.props(cardMarker)}>
    <span {...stylex.props(styles.toggle)} />
  </div>
);
`;
    const pair = {
      base: extractFile(before, 'a.tsx', options),
      head: extractFile(after, 'a.tsx', options),
    };
    const plan = planFile('a.tsx', pair.base, pair.head, { layoutComponents: [] });
    const toggle = plan.cases.find((entry) => entry.key === 'a.tsx|Goal#1');
    expect(toggle?.chainOmit).toBeUndefined();
    const module = generateModule(pair.head, plan, 'head', { layoutComponents: [] });
    const render = module.split('\n').find((line) => line.startsWith('"a.tsx|Goal#1"'));
    expect(render).toContain('data-synthetic-element="Goal#0"');
  });
});

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
});

import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { generateModule } from '../generate/module';
import { planFile } from './planFile';

const options = { adapters: [emotionStaticAdapter, stylexAdapter], layoutComponents: ['Flexbox'] };

const base = (element = '<Select className={styles.select} />') => `
import { createStaticStyles } from '@lobehub/ui';
import { Select } from './Select';

const styles = createStaticStyles(({ css }) => ({
  select: css\`width: 100%;\`,
  popup: css\`padding: 4px;\`,
}));

export const View = () => ${element};
`;

const head = (
  element = '<Select classNames={{ root: stylex.props(styles.select).className }} />',
) => `
import * as stylex from '@stylexjs/stylex';
import { Select } from './Select';

const styles = stylex.create({ select: { width: '100%' }, popup: { padding: '4px' } });

export const View = () => ${element};
`;

const generated = (before: string, after: string) => {
  const extractions = {
    base: extractFile(before, 'a.tsx', options),
    head: extractFile(after, 'a.tsx', options),
  };
  const plan = planFile('a.tsx', extractions.base, extractions.head, {
    layoutComponents: ['Flexbox'],
  });
  return {
    base: generateModule(extractions.base, plan, 'base', { layoutComponents: ['Flexbox'] }),
    head: generateModule(extractions.head, plan, 'head', { layoutComponents: ['Flexbox'] }),
    plan,
  };
};

describe('slot props on a stand-in', () => {
  it('leaves out slot probes that only one side has, so they do not reshape the stand-in', () => {
    const { head: module, plan } = generated(base(), head());
    expect(plan.cases[0].neutralOmitted).toEqual([0]);
    expect(plan.cases[0].flags).toContain('PLACEMENT_NEUTRAL_PROP');
    expect(module).not.toContain('__neutral("classNames"');
  });

  it('keeps slot probes that both sides pass with the same keys', () => {
    const {
      base: before,
      head: after,
      plan,
    } = generated(
      base('<Select classNames={{ popup: styles.popup }} />'),
      head('<Select classNames={{ popup: stylex.props(styles.popup).className }} />'),
    );
    expect(plan.cases[0].neutralOmitted).toBeUndefined();
    expect(before).toContain('__neutral("classNames"');
    expect(after).toContain('__neutral("classNames"');
  });

  it('leaves out probes whose slot keys differ between the sides', () => {
    const { plan } = generated(
      base('<Select classNames={{ popup: styles.popup }} />'),
      head('<Select classNames={{ root: stylex.props(styles.popup).className }} />'),
    );
    expect(plan.cases[0].neutralOmitted).toEqual([0]);
  });
});

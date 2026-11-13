import { describe, expect, it } from 'vitest';

import { generateModule } from '../generate/module';
import { planFile } from '../plan/planFile';
import { emotionStaticAdapter } from './adapters/emotionStatic';
import { extractFile } from './index';

const STYLES = `import { createStaticStyles } from '@lobehub/ui';

export const useStyles = createStaticStyles(({ css }) => ({
  container: css\`height: 32px;\`,
}));
`;

const COMPONENT = `import { useStyles } from './styles';

export const TabBar = () => {
  const styles = useStyles;
  return <div className={styles.container} />;
};
`;

const options = {
  adapters: [emotionStaticAdapter],
  layoutComponents: [],
  readModule: (_from: string, specifier: string) => (specifier === './styles' ? STYLES : undefined),
};

describe('a component that renames an imported style object locally', () => {
  it('reads the slots through the local name and renders with the real object', () => {
    const extraction = extractFile(COMPONENT, 'a.tsx', options);
    const [element] = extraction.elements;
    expect(element.slots).toEqual(['useStyles.container']);
    expect(element.variables).toEqual([]);
    expect(element.aliases).toEqual({ styles: 'useStyles' });
    expect(extraction.outsideReferences).toEqual([]);
    const plan = planFile('a.tsx', extraction, extraction, { layoutComponents: [] });
    expect(plan.cases[0].flags).toEqual([]);
    const module = generateModule(extraction, plan, 'base', { layoutComponents: [] });
    expect(module).toContain('const styles = useStyles;');
    expect(module).toContain("import { useStyles } from './styles';");
  });

  it('resolves the same local name to the object each component binds', () => {
    const code = `import { createStaticStyles } from '@lobehub/ui';

const a = createStaticStyles(({ css }) => ({ x: css\`color: red;\` }));
const b = createStaticStyles(({ css }) => ({ x: css\`color: blue;\` }));

export const A = () => {
  const styles = a;
  return <div className={styles.x} />;
};

export const B = () => {
  const styles = b;
  return <div className={styles.x} />;
};
`;
    const extraction = extractFile(code, 'a.tsx', options);
    expect(extraction.elements.map((element) => element.slots)).toEqual([['a.x'], ['b.x']]);
  });
});

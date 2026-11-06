import { describe, expect, it } from 'vitest';

import { emotionStaticAdapter } from '../extract/adapters/emotionStatic';
import { extractFile } from '../extract/index';
import { planFile } from '../plan/planFile';
import { generateModule } from './module';

const options = { adapters: [emotionStaticAdapter], layoutComponents: [] };

const source = `import { createStaticStyles, Icon, Tag } from '@lobehub/ui';

const styles = createStaticStyles(({ css }) => ({
  tag: css\`
    > :first-child {
      flex-shrink: 0;
    }
  \`,
  label: css\`color: red;\`,
}));

export const Card = () => (
  <Tag className={styles.tag} icon={<Icon icon={FolderIcon} />}>
    <span className={styles.label} />
  </Tag>
);
`;

describe('a stand-in component that receives an icon element', () => {
  it('renders a placeholder in front of its children so first-child rules land on the icon', () => {
    const extraction = extractFile(source, 'a.tsx', options);
    expect(extraction.elements[0].iconElement).toBe(true);
    const plan = planFile('a.tsx', extraction, extraction, { layoutComponents: [] });
    const module = generateModule(extraction, plan, 'base', { layoutComponents: [] });
    const render = module.split('\n').find((line) => line.startsWith('"a.tsx|Card#1"'));
    expect(render).toMatch(/data-synthetic-icon=""><\/span><span data-synthetic-element="Card#1"/);
  });

  it('gives the placeholder the classes of a styled icon element', () => {
    const head = source.replace(
      'icon={<Icon icon={FolderIcon} />}',
      'icon={<Icon className={styles.label} icon={FolderIcon} />}',
    );
    const extraction = extractFile(head, 'a.tsx', options);
    const tag = extraction.elements.find((element) => element.tag === 'Tag');
    expect(typeof tag?.iconElement).toBe('string');
    const plan = planFile('a.tsx', extraction, extraction, { layoutComponents: [] });
    const module = generateModule(extraction, plan, 'base', { layoutComponents: [] });
    const render = module.split('\n').find((line) => line.startsWith('"a.tsx|Card#0"'));
    expect(render).toContain('<span data-synthetic-icon="" className={styles.label}></span>');
  });
});

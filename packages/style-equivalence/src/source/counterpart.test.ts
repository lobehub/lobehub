import { describe, expect, it } from 'vitest';

import { counterpartOf } from './counterpart';

const base = `export const EvidenceItem = ({ flat }) => (
  <Flexbox>
    <Image
      preview
      variant={flat ? 'borderless' : 'outlined'}
      style={flat ? { borderRadius: 0 } : { maxWidth: '100%' }}
    />
    <video controls className={styles.evidenceVideo} />
  </Flexbox>
);
const Other = () => <Image src="x" />;
`;

const head = `export const EvidenceItem = ({ flat }) => (
  <Flexbox>
    <Image
      preview
      style={{ maxWidth: '100%' }}
      {...(flat ? comparisonMedia.image : { variant: 'outlined' as const })}
    />
    <video controls {...videoProps} />
  </Flexbox>
);
`;

describe('counterpartOf', () => {
  it('finds the same-position element on the other side when it has no style class', () => {
    expect(
      counterpartOf({
        expr: "(flat ? comparisonMedia.image : { variant: 'outlined' as const })",
        from: head,
        owner: 'EvidenceItem',
        tag: 'Image',
        to: base,
      }),
    ).toBe(`<Image
  preview
  variant={flat ? 'borderless' : 'outlined'}
  style={flat ? { borderRadius: 0 } : { maxWidth: '100%' }}
/>`);
  });

  it('stays inside the owner component', () => {
    expect(
      counterpartOf({ expr: 'styles.x', from: head, owner: 'Other', tag: 'Image', to: base }),
    ).toBe('<Image src="x" />');
  });

  it('gives up when the other side has no element with that tag in the owner', () => {
    expect(
      counterpartOf({
        expr: 'styles.x',
        from: head,
        owner: 'EvidenceItem',
        tag: 'audio',
        to: base,
      }),
    ).toBeUndefined();
  });
});

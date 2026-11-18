import { describe, expect, it } from 'vitest';

import { counterpartLeafOf, counterpartOf } from './counterpart';

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

describe('counterpartLeafOf', () => {
  it('describes the other-side element so it can be rendered next to the unpaired one', () => {
    expect(
      counterpartLeafOf({
        expr: "(flat ? comparisonMedia.image : { variant: 'outlined' as const })",
        from: head,
        owner: 'EvidenceItem',
        tag: 'Image',
        to: base,
      }),
    ).toEqual({
      inlineStyle: "flat ? { borderRadius: 0 } : { maxWidth: '100%' }",
      literalProps: { preview: true },
      props: "{ \"variant\": (flat ? 'borderless' : 'outlined') }",
      tag: 'Image',
      variables: [{ kind: 'boolean', name: 'flat' }],
    });
  });

  it('marks a configured real component imported from its source', () => {
    const code = `import { Text } from '@lobehub/ui';
export const Row = ({ label }) => <Text as="span" title={label.name}>x</Text>;
`;
    expect(
      counterpartLeafOf({
        expr: 'styles.x',
        from: code,
        owner: 'Row',
        real: { Text: { source: '@lobehub/ui' } },
        tag: 'Text',
        to: code,
      }),
    ).toEqual({
      literalProps: { as: 'span' },
      props: '{ "title": (label.name) }',
      real: true,
      tag: 'Text',
      variables: [{ kind: 'unknown', name: 'label' }],
    });
  });
});

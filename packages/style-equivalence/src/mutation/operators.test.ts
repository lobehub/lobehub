import { describe, expect, it } from 'vitest';

import {
  applyMutation,
  conditionMutations,
  declarationMutations,
  type Mutation,
  stylesheetMutations,
} from './operators';

const results = (code: string, mutations: Mutation[]) =>
  Object.fromEntries(
    mutations.map((mutation) => [mutation.operator, applyMutation(code, mutation)]),
  );

describe('declarationMutations on stylex', () => {
  const code = `import * as stylex from '@stylexjs/stylex';
export const styles = stylex.create({
  label: { color: cssVar.colorText, padding: '8px 4px', opacity: { default: 1, ':hover': 0.5 } },
  other: { color: cssVar.colorTextSecondary },
});
`;

  it('produces one mutation per operator on the member', () => {
    const mutated = results(code, declarationMutations(code, 'styles', 'label'));
    expect(mutated.numeric).toContain("padding: '9px 4px'");
    expect(mutated['delete-declaration']).toContain('label: { padding:');
    expect(mutated['swap-token']).toContain('label: { color: cssVar.colorTextSecondary,');
    expect(mutated['delete-state']).toContain('opacity: { default: 1 }');
  });

  it('swaps a token for the one in its own family', () => {
    const source = `const styles = stylex.create({ a: { borderRadius: cssVar.borderRadius, color: cssVar.colorText } });
const other = [cssVar.colorFill, cssVar.borderRadiusLG];
`;
    const swap = declarationMutations(source, 'styles', 'a').find(
      (item) => item.operator === 'swap-token',
    )!;
    expect(swap.replacement).toBe('cssVar.borderRadiusLG');
  });

  it('finds nothing for a member the factory does not declare', () => {
    expect(declarationMutations(code, 'styles', 'missing')).toEqual([]);
  });
});

describe('declarationMutations on a css template', () => {
  const code = `import { createStaticStyles } from '@lobehub/ui';
const styles = createStaticStyles(({ css, cssVar }) => ({
  label: css\`
    gap: 6px;
    color: \${cssVar.colorText};

    &:hover {
      color: \${cssVar.colorTextSecondary};
    }
  \`,
}));
`;

  it('edits the template text and the token placeholders', () => {
    const mutated = results(code, declarationMutations(code, 'styles', 'label'));
    expect(mutated.numeric).toContain('gap: 7px;');
    expect(mutated['delete-declaration']).not.toContain('gap: 6px;');
    expect(mutated['swap-token']).toContain('color: ${cssVar.colorTextSecondary};\n\n    &:hover');
    expect(mutated['delete-state']).not.toContain('&:hover');
    expect(mutated['delete-state']).toContain('gap: 6px;');
  });
});

describe('stylesheetMutations', () => {
  const css = `.title { font-weight: 600; color: var(--ink); }
.title:hover { color: red; }
.other { color: var(--ink-alias); }
`;

  it('mutates the rules of the class', () => {
    const mutated = results(css, stylesheetMutations(css, 'title'));
    expect(mutated.numeric).toContain('font-weight: 601;');
    expect(mutated['delete-declaration']).toContain('.title { color: var(--ink); }');
    expect(mutated['swap-token']).toContain(
      '.title { font-weight: 600; color: var(--ink-alias); }',
    );
    expect(mutated['delete-state']).not.toContain('.title:hover');
  });
});

describe('conditionMutations', () => {
  it('negates a guard and swaps ternary branches', () => {
    const [guard] = conditionMutations('cx(styles.a, muted && styles.b)');
    expect(applyMutation('cx(styles.a, muted && styles.b)', guard)).toBe(
      'cx(styles.a, !(muted) && styles.b)',
    );
    const [ternary] = conditionMutations('active ? styles.on : styles.off');
    expect(applyMutation('active ? styles.on : styles.off', ternary)).toBe(
      'active ? styles.off : styles.on',
    );
  });
});

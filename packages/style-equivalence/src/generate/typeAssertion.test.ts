import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { stylexAdapter } from '../extract/adapters/stylex';
import { extractFile } from '../extract/index';
import { planFile } from '../plan/planFile';
import { generateModule } from './module';

const options = { adapters: [stylexAdapter], layoutComponents: [] };

const source = `import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({ image: { width: '4px' } });

export const Item = ({ flat }) => (
  <div {...(flat ? stylex.props(styles.image) : { variant: 'outlined' as const })} />
);
`;

describe('a style expression with a type assertion', () => {
  it('declares only value names, so the generated module still parses', () => {
    const extraction = extractFile(source, 'a.tsx', options);
    expect(extraction.elements[0].variables.map((variable) => variable.name)).toEqual(['flat']);
    const plan = planFile('a.tsx', extraction, extraction, { layoutComponents: [] });
    const module = generateModule(extraction, plan, 'head', { layoutComponents: [] });
    const { diagnostics } = ts.transpileModule(module, {
      compilerOptions: { jsx: ts.JsxEmit.Preserve },
      fileName: 'a.tsx',
      reportDiagnostics: true,
    });
    expect(diagnostics?.map((entry) => entry.messageText)).toEqual([]);
  });
});

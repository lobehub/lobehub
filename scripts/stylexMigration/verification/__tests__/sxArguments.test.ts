import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { expect, it } from 'vitest';

it('accepts compiled markers, custom properties, dynamic styles and nested conditions', () => {
  const filename = fileURLToPath(new URL('./sx-arguments.contract.ts', import.meta.url));
  const source = `
    import * as stylex from '@stylexjs/stylex';
    import { sx } from '../../../../src/styles/sx';
    const styles = stylex.create({
      root: { color: 'red' },
      custom: { '--gradient-stop': '80px' },
      dynamic: (color: string) => ({ color, '--operator-color': color }),
    });
    const marker = stylex.defineMarker();
    sx([styles.root, styles.custom, marker, stylex.defaultMarker()]);
    sx([styles.dynamic('blue'), [true, false, null, undefined, styles.root]]);
    sx(styles.root, 'caller-class', { margin: 1 });
    // @ts-expect-error Raw CSS objects are not compiled StyleX arguments.
    sx({ color: 'red' });
  `;
  const options: ts.CompilerOptions = {
    esModuleInterop: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
    file === filename
      ? ts.createSourceFile(file, source, languageVersion, true)
      : originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram({ host, options, rootNames: [filename] });
  const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
  expect(diagnostics).toEqual([]);
});

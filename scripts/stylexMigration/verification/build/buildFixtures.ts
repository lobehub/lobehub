import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { bindingObserverExport, prepareStyleBindings } from '../analysis/styleBindings';
import type { StyleFixture } from '../fixtures/fixtureRegistry';
import { prepareFixtureHost } from '../fixtures/host';
import { writeJson } from '../reporting/report';
import { compileFixtureTools } from './compileFixtureTools';
import { runIsolatedProcess } from './isolatedProcess';

export const buildComponentFixture = async (
  root: string,
  sourceDirectory: string,
  fixture: StyleFixture,
  side: 'base' | 'candidate',
) => {
  const started = performance.now();
  const { componentSource, fixtureHashes, relativeTools, tools } = await prepareFixtureHost(
    root,
    sourceDirectory,
    fixture,
    side,
  );
  const bindingPlan = await prepareStyleBindings(root, componentSource);
  await writeJson(tools, 'style-bindings.json', {
    ...bindingPlan,
    observerExport: bindingObserverExport(bindingPlan),
  });
  await writeJson(tools, 'fixture-boundaries.json', fixture.moduleBoundaries);
  await writeFile(
    path.join(tools, 'fixtureResolvers.ts'),
    await readFile(path.join(sourceDirectory, 'build/fixtureResolvers.ts')),
    { flag: 'wx' },
  );
  await writeFile(
    path.join(tools, 'fixtureBuildWorker.ts'),
    await readFile(path.join(sourceDirectory, 'build/fixtureBuildWorker.ts')),
    { flag: 'wx' },
  );
  const compiler = await compileFixtureTools(
    root,
    [
      { source: 'plugins/vite/stylex.ts', output: 'stylex.mjs' },
      { source: 'plugins/vite/lobeUiImports.ts', output: 'lobeUiImports.mjs' },
      { source: `${relativeTools}/fixtureBuildWorker.ts`, output: 'fixtureBuildWorker.mjs' },
    ],
    `${relativeTools}/compiler`,
  );
  await writeJson(tools, 'compiler.json', compiler);
  const built = await runIsolatedProcess(
    root,
    process.execPath,
    [path.join(tools, 'compiler/fixtureBuildWorker.mjs'), componentSource, relativeTools],
    [process.execPath],
    tools,
  );
  await writeFile(path.join(tools, 'build.log'), built.stdout + built.stderr, { flag: 'wx' });
  const result = {
    componentSource,
    bindingPlan,
    durationMs: performance.now() - started,
    fixtureHashes,
    fixtureId: fixture.id,
    dataBoundaries: JSON.parse(
      await readFile(path.join(tools, 'fixture-boundary-hits.json'), 'utf8'),
    ) as string[],
    modules: JSON.parse(await readFile(path.join(tools, 'build-modules.json'), 'utf8')) as string[],
    sandbox: 'macos-sandbox-exec',
    toolchain: { node: process.version, compiler },
    output: path.join(tools, 'dist'),
  };
  await writeJson(tools, 'fixture-build.json', result);
  return result;
};

import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { StyleFixture } from './fixtureRegistry';
import { styleFixtureSchema } from './fixtureRegistry';
import { sha256 } from './report';

/** Only copies declared trusted fixture files; never borrows product modules. */
export const prepareFixtureHost = async (
  root: string,
  sourceDirectory: string,
  definition: StyleFixture,
  side: 'base' | 'candidate',
) => {
  const fixture = styleFixtureSchema.parse(definition);
  const sourceRoot = await realpath(sourceDirectory);
  const relativeTools = `.stylex-tools/fixtures/${fixture.id}`;
  const tools = path.join(root, relativeTools);
  await mkdir(path.dirname(tools), { recursive: true });
  await mkdir(tools);
  const host = path.join(tools, 'host');
  await mkdir(host);
  const fixtureHashes: Record<string, string> = {};
  for (const file of new Set([fixture.host, fixture.render, ...fixture.assets])) {
    const source = await realpath(path.join(sourceRoot, file));
    if (!source.startsWith(sourceRoot + path.sep)) throw new Error('FIXTURE_SOURCE_ESCAPE');
    const content = await readFile(source);
    const target = path.resolve(host, file);
    if (!target.startsWith(host + path.sep)) throw new Error('FIXTURE_OUTPUT_ESCAPE');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { flag: 'wx' });
    fixtureHashes[file] = sha256(content);
  }
  const component = fixture.component[side];
  await writeFile(
    path.join(host, 'component.ts'),
    `export {${component.exportName} as ${fixture.component.id}, __styleVerificationBindings, __styleVerificationCompositions} from ${JSON.stringify(path.join(root, component.source))};\n`,
    { flag: 'wx' },
  );
  await writeFile(
    path.join(host, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><script type="module" src="./entry.tsx"></script></body></html>',
    { flag: 'wx' },
  );
  await writeFile(
    path.join(host, 'entry.tsx'),
    `import {startFixture} from ${JSON.stringify('./' + fixture.host)}; import {Fixture} from ${JSON.stringify('./' + fixture.render)}; import {__styleVerificationBindings,__styleVerificationCompositions} from "verification:component"; Object.defineProperty(globalThis,"__styleVerificationBindings",{value:__styleVerificationBindings}); Object.defineProperty(globalThis,"__styleVerificationCompositions",{value:__styleVerificationCompositions}); startFixture(Fixture,${JSON.stringify(fixture.styleVariants.map((variant) => variant.id))},${JSON.stringify(fixture.containerMode)});\n`,
    { flag: 'wx' },
  );
  return { componentSource: component.source, fixtureHashes, host, relativeTools, tools };
};

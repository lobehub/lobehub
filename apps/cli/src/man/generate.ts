import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { cliVersion, createProgram } from '../program';
import { generateAliasManPage, generateRootManPage } from './roff';

const outputDir = fileURLToPath(new URL('../../man/man1/', import.meta.url));

await mkdir(outputDir, { recursive: true });

const program = createProgram();

await Promise.all([
  writeFile(`${outputDir}lh.1`, generateRootManPage(program, cliVersion)),
  writeFile(`${outputDir}lobe.1`, generateAliasManPage('lh')),
  writeFile(`${outputDir}lobehub.1`, generateAliasManPage('lh')),
]);

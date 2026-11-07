import { writeFile } from 'node:fs/promises';

import { type BuildOptions, buildSide } from './viteBuild';

export const failingModules = (message: string, written: string[]) =>
  written.filter((file) => message.includes(file));

export const stubModule = (reason: string) =>
  [
    'export const cases = {};',
    `export const error = ${JSON.stringify(`SYNTHETIC_BUILD_FAILED: ${reason.split('\n')[0]}`)};`,
    '',
  ].join('\n');

const reasonFor = (message: string, file: string) => {
  const line = message.split('\n').find((text) => text.includes(`${file}: `));
  return line ? line.slice(line.indexOf(`${file}: `) + file.length + 2) : 'build error';
};

export const buildWithStubs = async (options: BuildOptions, written: string[]) => {
  const stubbed = new Set<string>();
  for (;;) {
    try {
      return { output: await buildSide(options), stubbed: [...stubbed] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failing = failingModules(message, written).filter((file) => !stubbed.has(file));
      if (!failing.length) throw error;
      for (const file of failing) {
        await writeFile(file, stubModule(reasonFor(message, file)));
        stubbed.add(file);
      }
    }
  }
};

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ChaosExperiment } from '@achaos/core';
import { chaosExperimentSchema } from '@achaos/core';
import { parse } from 'yaml';

const walk = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(entryPath) : [entryPath];
    }),
  );
  return nested.flat().filter((filePath) => ['.yaml', '.yml'].includes(path.extname(filePath)));
};

export interface LoadedChaosExperiment {
  experiment: ChaosExperiment;
  filePath: string;
}

export const loadChaosExperiments = async (directory: string): Promise<LoadedChaosExperiment[]> => {
  const paths = await walk(directory);
  return Promise.all(
    paths.sort().map(async (filePath) => {
      const raw = parse(await readFile(filePath, 'utf8'));
      const experiment = chaosExperimentSchema.parse(raw) as ChaosExperiment;
      return { experiment, filePath };
    }),
  );
};

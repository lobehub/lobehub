import { writeFile } from 'node:fs/promises';

import type { ChaosRunResult } from '@achaos/core';

export const formatChaosResult = (result: ChaosRunResult) =>
  JSON.stringify(
    {
      ...result,
      schemaVersion: 1,
    },
    undefined,
    2,
  );

export const writeChaosResult = async (filePath: string, result: ChaosRunResult) => {
  await writeFile(filePath, `${formatChaosResult(result)}\n`, 'utf8');
};

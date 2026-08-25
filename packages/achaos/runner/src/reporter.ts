import { writeFile } from 'node:fs/promises';

import type { ChaosRunResult } from '@achaos/core';

const createSafeReplacer = () => {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown) => {
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function' || typeof value === 'symbol')
      return `[Unsupported ${typeof value}]`;
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
};

export const formatChaosResult = (result: ChaosRunResult) =>
  JSON.stringify(
    {
      ...result,
      ...(result.injection
        ? {
            injection: {
              adapter: result.injection.adapter,
              details: result.injection.details,
              injectionId: result.injection.injectionId,
            },
          }
        : {}),
      schemaVersion: 1,
    },
    createSafeReplacer(),
    2,
  );

export const writeChaosResult = async (filePath: string, result: ChaosRunResult) => {
  await writeFile(filePath, `${formatChaosResult(result)}\n`, 'utf8');
};

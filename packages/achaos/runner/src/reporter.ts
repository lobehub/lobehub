import { writeFile } from 'node:fs/promises';

import type { ChaosRunResult } from '@achaos/core';

const createSafeReplacer = () => {
  const ancestors: object[] = [];
  return function (this: object, _key: string, value: unknown) {
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function' || typeof value === 'symbol')
      return `[Unsupported ${typeof value}]`;
    if (value && typeof value === 'object') {
      while (ancestors.length > 0 && ancestors.at(-1) !== this) ancestors.pop();
      if (ancestors.includes(value)) return '[Circular]';
      ancestors.push(value);
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

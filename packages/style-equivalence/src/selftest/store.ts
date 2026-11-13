import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { VERIFIER_VERSION } from '../run';
import type { SelfTestReport } from './run';

export const SELF_TEST_FILE = 'self-test.json';

export const saveSelfTest = (recordsDir: string, report: SelfTestReport, ranAt: string) =>
  writeFile(
    path.join(recordsDir, SELF_TEST_FILE),
    `${JSON.stringify({ ...report, ranAt, verifierVersion: VERIFIER_VERSION }, null, 2)}\n`,
  );

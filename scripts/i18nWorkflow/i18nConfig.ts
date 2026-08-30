import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import type { WorkflowConfig } from './i18nWorkflow';

const require = createRequire(import.meta.url);

export const root = [process.argv[2], process.env.I18N_WORKFLOW_ROOT, resolve(__dirname, '../..')]
  .filter(Boolean)
  .find((p) => existsSync(p!)) as string;

const rcFile = resolve(root, '.i18nrc');

const config: WorkflowConfig = require(rcFile);

export default config;

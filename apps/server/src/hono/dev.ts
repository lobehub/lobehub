import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

const env = process.env.NODE_ENV || 'development';

const rootEnvPath = (file: string) =>
  fileURLToPath(new URL(`../../../../${file}`, import.meta.url));

const shellEnv = Object.entries(process.env).reduce<Record<string, string>>((acc, [key, value]) => {
  if (typeof value === 'string') acc[key] = value;
  return acc;
}, {});
const dotenvEnv: Record<string, string> = {};
const dotenvResult = dotenv.config({
  override: true,
  path: [rootEnvPath('.env'), rootEnvPath(`.env.${env}`), rootEnvPath(`.env.${env}.local`)],
  processEnv: dotenvEnv,
});

if (dotenvResult.parsed) {
  const expanded = dotenvExpand.expand({
    parsed: dotenvResult.parsed,
    processEnv: { ...dotenvEnv, ...shellEnv },
  });

  Object.assign(process.env, expanded.parsed, shellEnv);
}

(process.env as Record<string, string | undefined>).NODE_ENV ||= 'development';

await import('./standalone');

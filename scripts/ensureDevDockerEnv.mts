import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SECRET_PATTERN = /^SEARXNG_SECRET=.*$/m;

export const ensureDevDockerEnv = async (
  envDirectory = path.resolve(process.cwd(), 'docker-compose/dev'),
) => {
  const examplePath = path.join(envDirectory, '.env.example');
  const envPath = path.join(envDirectory, '.env');

  try {
    await fs.access(envPath);
  } catch {
    await fs.copyFile(examplePath, envPath);
  }

  const env = await fs.readFile(envPath, 'utf8');
  const currentSecret = env.match(/^SEARXNG_SECRET=(.+)$/m)?.[1]?.trim();
  if (currentSecret) {
    await fs.chmod(envPath, 0o600);
    return;
  }

  const secretLine = `SEARXNG_SECRET=${randomBytes(32).toString('hex')}`;
  const nextEnv = SECRET_PATTERN.test(env)
    ? env.replace(SECRET_PATTERN, secretLine)
    : `${env.trimEnd()}\n${secretLine}\n`;

  await fs.writeFile(envPath, nextEnv);
  await fs.chmod(envPath, 0o600);
  console.info('Generated docker-compose/dev/.env with a local SearXNG secret.');
};

const entrypoint = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href;
if (entrypoint === import.meta.url) await ensureDevDockerEnv();

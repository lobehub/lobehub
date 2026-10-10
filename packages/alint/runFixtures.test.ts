import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { hasFixtureProvider } from './runFixtures';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDirs: string[] = [];
const provider = `version = 1
[[providers]]
id = "fixture-provider"
type = "openai-compatible"
endpoint = "http://127.0.0.1:1/v1"
[[providers.models]]
id = "fixture-model"
aliases = ["default"]
capabilities = ["tool-call"]
`;

const setup = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'alint-provider-test-'));
  tempDirs.push(dir);
  const project = path.join(dir, 'project');
  const configHome = path.join(dir, 'config');
  await mkdir(path.join(project, 'node_modules/.bin'), { recursive: true });
  await symlink(
    path.join(rootDir, 'node_modules/.bin/alint'),
    path.join(project, 'node_modules/.bin/alint'),
  );
  const env = { ...process.env, XDG_CONFIG_HOME: configHome };
  return { configHome, env, project };
};

const writeConfig = async (file: string, content: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('fixture provider detection', () => {
  it('uses a global model even when the project has no setup file', async () => {
    const { configHome, env, project } = await setup();
    await writeConfig(path.join(configHome, 'alint/config.toml'), provider);
    expect(await hasFixtureProvider(project, env)).toBe(true);
  });

  it('uses a project-local model without global setup', async () => {
    const { env, project } = await setup();
    await writeConfig(path.join(project, '.alint/config.toml'), provider);
    expect(await hasFixtureProvider(project, env)).toBe(true);
  });

  it('does not treat an empty setup file as a configured model', async () => {
    const { env, project } = await setup();
    await writeConfig(path.join(project, '.alint/config.toml'), 'version = 1\n');
    expect(await hasFixtureProvider(project, env)).toBe(false);
  });

  it('returns false when neither scope configures a model', async () => {
    const { env, project } = await setup();
    expect(await hasFixtureProvider(project, env)).toBe(false);
  });

  it('fails on invalid setup instead of silently skipping calibration', async () => {
    const { env, project } = await setup();
    await writeConfig(path.join(project, '.alint/config.toml'), 'invalid = [');
    await expect(hasFixtureProvider(project, env)).rejects.toThrow();
  });
});

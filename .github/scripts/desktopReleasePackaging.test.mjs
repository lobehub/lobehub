import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readJson = async (path) =>
  JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'));

const root = (await readJson('package.json')).scripts;
const desktop = (await readJson('apps/desktop/package.json')).scripts;
const buildElectron = await readFile(
  new URL('../../scripts/electronWorkflow/buildElectron.ts', import.meta.url),
  'utf8',
);
const platformScripts = [
  ...buildElectron.matchAll(/npm run (package:\w+) --prefix=\.\/apps\/desktop/g),
].map((match) => match[1]);

const expand = (scripts, name, platform) => {
  const script = scripts[name];
  assert.ok(script, `script ${name} exists`);
  return script.split('&&').flatMap((part) => {
    const command = part.trim();
    if (command === 'tsx scripts/electronWorkflow/buildElectron.ts') {
      return expand(desktop, platform, platform);
    }
    const call = command.match(
      /^(?:cross-env (?:\S+=\S+ )+)?npm run ([\w:-]+)( --prefix=\.\/apps\/desktop)?$/,
    );
    if (!call) return [command];
    return expand(call[2] ? desktop : scripts, call[1], platform);
  });
};

test('every desktop package entry point builds the main bundle once', () => {
  assert.deepEqual(platformScripts, ['package:mac', 'package:win', 'package:linux']);
  for (const [entry, platforms] of [
    ['desktop:package:app', platformScripts],
    ['desktop:package:local', ['package:local']],
  ]) {
    for (const platform of platforms) {
      const commands = expand(root, entry, platform);
      const builds = commands.filter((command) => command.includes('vite.main.config.ts'));
      assert.equal(builds.length, 1, `${entry} on ${platform} runs build:main once`);
      assert.ok(commands.at(-1).startsWith('electron-builder'), `${entry} ends by packaging`);
    }
  }
});

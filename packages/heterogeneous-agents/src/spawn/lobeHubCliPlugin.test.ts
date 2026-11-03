import { chmod, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  buildHeterogeneousPrompt,
  lobeHubCliGuide,
  lobeHubCliGuideBlock,
  lobeHubCliSkillBody,
  lobeHubCliSkillDescription,
} from '../protocol';
import {
  claudeCodeLoadsPluginSkills,
  prepareClaudeCodeLobeHubCli,
  resolveLobeHubCliPluginDir,
} from './lobeHubCliPlugin';

const posixOnly = process.platform === 'win32' ? it.skip : it;

describe('LobeHub CLI plugin', () => {
  let parent: string;
  let rootDir: string;

  beforeEach(async () => {
    parent = await mkdtemp(path.join(tmpdir(), 'lobehub-cli-plugin-test-'));
    rootDir = path.join(parent, 'root');
  });

  afterEach(async () => {
    await rm(parent, { force: true, recursive: true });
  });

  it('writes a Claude Code plugin whose skill frontmatter parses', async () => {
    const pluginDir = await resolveLobeHubCliPluginDir({ rootDir });

    const manifest = JSON.parse(
      await readFile(path.join(pluginDir!, '.claude-plugin/plugin.json'), 'utf8'),
    );
    expect(manifest.name).toBe('lobehub');

    const skill = await readFile(path.join(pluginDir!, 'skills/lobehub/SKILL.md'), 'utf8');
    const [, frontmatter, body] = skill.split(/^---$/m);
    // The description contains `: `, which an unquoted YAML scalar rejects.
    expect(parse(frontmatter)).toEqual({
      description: lobeHubCliSkillDescription,
      name: 'lobehub',
    });
    expect(body.trim()).toBe(lobeHubCliSkillBody);
  });

  it('reuses one directory for the same guide', async () => {
    const first = await resolveLobeHubCliPluginDir({ rootDir });
    const second = await resolveLobeHubCliPluginDir({ rootDir });

    expect(second).toBe(first);
  });

  it('rewrites a plugin a temp-directory cleanup removed', async () => {
    const pluginDir = await resolveLobeHubCliPluginDir({ rootDir });
    await rm(pluginDir!, { force: true, recursive: true });

    await expect(resolveLobeHubCliPluginDir({ rootDir })).resolves.toBe(pluginDir);
    await expect(readFile(path.join(pluginDir!, 'skills/lobehub/SKILL.md'))).resolves.toBeTruthy();
  });

  posixOnly('refuses a root other users can write into', async () => {
    await mkdir(rootDir, { mode: 0o700 });
    await chmod(rootDir, 0o777);

    await expect(resolveLobeHubCliPluginDir({ rootDir })).resolves.toBeUndefined();
  });

  posixOnly('refuses a root that is a symlink', async () => {
    const elsewhere = path.join(parent, 'elsewhere');
    await mkdir(elsewhere, { mode: 0o700 });
    await symlink(elsewhere, rootDir);

    await expect(resolveLobeHubCliPluginDir({ rootDir })).resolves.toBeUndefined();
  });

  describe('prepareClaudeCodeLobeHubCli', () => {
    const version = '2.1.301';
    const prompt = buildHeterogeneousPrompt({
      isNewSession: true,
      prompt: 'fix the failing test',
      systemContext: 'selected code',
    });
    const withoutGuide = [
      { text: 'selected code', type: 'text' },
      { text: 'fix the failing test', type: 'text' },
    ];
    const unwritableRoot = async () => {
      await mkdir(rootDir, { mode: 0o700 });
      await chmod(rootDir, 0o755);
    };

    it('swaps the in-message guide for the plugin and keeps everything else', async () => {
      const delivery = await prepareClaudeCodeLobeHubCli(prompt, [], { rootDir, version });

      expect(prompt).toContainEqual(lobeHubCliGuideBlock);
      expect(delivery.prompt).toEqual(withoutGuide);
      expect(delivery.args).toEqual([
        '--plugin-dir',
        await resolveLobeHubCliPluginDir({ rootDir }),
      ]);
    });

    // Regression: Claude Code before plugin skills rejects `--plugin-dir` and
    // never starts the turn; the binary checks accept any version.
    it.each(['1.2.3', '2.0.19', 'unknown', undefined])(
      'keeps the guide in the prompt for Claude Code %s',
      async (oldVersion) => {
        const delivery = await prepareClaudeCodeLobeHubCli(prompt, [], {
          rootDir,
          version: oldVersion,
        });

        expect(delivery).toEqual({ args: [], prompt });
      },
    );

    it('keeps the guide in the prompt when skills are disabled', async () => {
      const delivery = await prepareClaudeCodeLobeHubCli(prompt, ['--disable-slash-commands'], {
        rootDir,
        version,
      });

      expect(delivery).toEqual({ args: [], prompt });
    });

    posixOnly('keeps the guide in the prompt of a new session without a plugin', async () => {
      await unwritableRoot();

      const delivery = await prepareClaudeCodeLobeHubCli(prompt, [], { rootDir, version });

      expect(delivery).toEqual({ args: [], prompt });
    });

    // Regression: a resumed turn carries no in-message copy, and earlier turns
    // may have had the plugin, so losing the plugin must not lose the guide.
    // (An appended system prompt would not reach it: `--resume` keeps the
    // session's original one.)
    posixOnly('puts the guide back into a resumed turn that has no plugin', async () => {
      await unwritableRoot();

      const delivery = await prepareClaudeCodeLobeHubCli('carry on', [], {
        resumed: true,
        rootDir,
        version,
      });

      expect(delivery).toEqual({
        args: [],
        prompt: [lobeHubCliGuideBlock, { text: 'carry on', type: 'text' }],
      });
    });

    posixOnly('adds no second copy to a resumed turn that already carries one', async () => {
      await unwritableRoot();
      // A dispatcher predating the tag sends the guide untagged.
      const untagged = [
        { text: lobeHubCliGuide, type: 'text' as const },
        { text: 'hi', type: 'text' as const },
      ];

      const delivery = await prepareClaudeCodeLobeHubCli(untagged, [], {
        resumed: true,
        rootDir,
        version,
      });

      expect(delivery).toEqual({ args: [], prompt: untagged });
    });

    it('keeps a resumed turn unchanged apart from loading the plugin', async () => {
      const delivery = await prepareClaudeCodeLobeHubCli('carry on', [], {
        resumed: true,
        rootDir,
        version,
      });

      expect(delivery).toEqual({
        args: ['--plugin-dir', await resolveLobeHubCliPluginDir({ rootDir })],
        prompt: 'carry on',
      });
    });
  });

  posixOnly("moves to the user's cache directory when the temp root is unusable", async () => {
    const env = { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
    const owner = String(process.getuid!());
    process.env.TMPDIR = path.join(parent, 'tmp');
    process.env.HOME = path.join(parent, 'home');
    try {
      await mkdir(path.join(parent, 'tmp', `lobehub-cli-plugin-${owner}`), { recursive: true });
      await chmod(path.join(parent, 'tmp', `lobehub-cli-plugin-${owner}`), 0o777);

      const pluginDir = await resolveLobeHubCliPluginDir();

      expect(pluginDir?.startsWith(path.join(parent, 'home', '.cache', 'lobehub-cli-plugin'))).toBe(
        true,
      );
    } finally {
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it.each([
    ['2.0.20', true],
    ['2.1.0', true],
    ['10.0.0', true],
    ['2.1.301 (Claude Code)', true],
    ['Claude Code v2.0.20', true],
    ['1.2 then 2.0.20', true],
    ['0.2.0.20', false],
    ['2.0.19', false],
    ['1.9.99', false],
  ])('treats Claude Code %s as loading plugin skills: %s', (version, expected) => {
    expect(claudeCodeLoadsPluginSkills(version)).toBe(expected);
  });

  it.each([
    ['major without separators', (digits: string) => digits, false],
    ['missing patch', (digits: string) => `${digits}.0`, false],
    ['long minor', (digits: string) => `2.${digits}`, false],
    ['digits before a valid version', (digits: string) => `${digits}x 2.0.20`, true],
  ] as const)('parses a long banner with %s', (_name, banner, expected) => {
    const version = banner('9'.repeat(100_000));

    expect(claudeCodeLoadsPluginSkills(version)).toBe(expected);
  });
});
